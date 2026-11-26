// The rental catalog. A variant (one color of a tablecloth) is a complete product row with its own
// price and quantity; `variant_group` + `variant_name` only group it on the catalog screen.

import { z } from 'zod';
import { POLICIES } from '$lib/roles';
import { requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate } from '../audit';
import { fold } from '$lib/format';

/** Fixed, like the CHECK on `products.category`: a new category is a code change. */
export const CATEGORIES = [
	'CHAIRS_TABLES',
	'LINENS',
	'GLASSWARE',
	'CUTLERY',
	'TABLEWARE',
	'CHAFERS_TRAYS',
	'DECOR'
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Product = {
	id: number;
	name: string;
	category: Category;
	variantGroup: string | null;
	variantName: string | null;
	description: string | null;
	/** The product's page on consueloc.com, or anywhere: a reference for the team, never shown to clients. */
	websiteUrl: string | null;
	/** What replacing one lost or unrecoverable unit costs, in whole pesos; null when unknown. */
	replacementCost: number | null;
	rentalPrice: number;
	totalQuantity: number;
	isActive: boolean;
};

/** A variant group the form's picker offers, with the category its variants are in. */
export type VariantGroup = { name: string; category: Category };

type Failure = { ok: false; message: string; field?: string };
export type Result = { ok: true; id: number } | Failure;

/** A catalog row: when its `total_quantity` last changed (epoch seconds), for the list's ℹ. */
export type ListedProduct = Product & { quantityUpdatedAt: number };

type ProductRow = {
	id: number;
	name: string;
	category: Category; // the CHECK admits nothing else
	variant_group: string | null;
	variant_name: string | null;
	rental_price: number;
	total_quantity: number;
	active: number;
	attributes: string;
};

// Blank is no key at all: a missing key means empty.
const blankableTextSchema = z
	.string()
	.trim()
	.optional()
	.transform((value) => value || undefined);

/** What the app only reads about a product: nothing filters, sorts or indexes by these keys. */
const productAttributesSchema = z.strictObject({
	description: blankableTextSchema,
	website_url: blankableTextSchema,
	replacement_cost: z.number().int().positive().optional()
});

type ProductAttributes = z.input<typeof productAttributesSchema>;

// In a fixed key order, so an edit that changes nothing produces the same text and logs nothing.
function attributesJson(attributes: ProductAttributes): string {
	const { description, website_url, replacement_cost } = productAttributesSchema.parse(attributes);
	return JSON.stringify({ description, website_url, replacement_cost });
}

const WEBSITE_URL_MESSAGE = 'Escribe una dirección web válida, que empiece con https://';

function withHttps(address: string): string {
	return /^[a-z][a-z\d+.-]*:/i.test(address) ? address : `https://${address}`;
}

// Any site, not only consueloc.com's; a host without a dot is a typo, not a page.
function isWebsiteUrl(address: string): boolean {
	if (!URL.canParse(address)) {
		return false;
	}
	const { protocol, hostname } = new URL(address);
	return 'https:' === protocol && /\.[a-z]{2,}$/i.test(hostname);
}

// Typed without its scheme, https:// is added; blank is no key.
const websiteUrlSchema = z
	.string()
	.trim()
	.optional()
	.transform((value) => (value ? withHttps(value) : undefined))
	.refine((value) => undefined === value || isWebsiteUrl(value), WEBSITE_URL_MESSAGE);

const optionalTextSchema = z
	.string()
	.trim()
	.optional()
	.transform((value) => value || null);

// Thousands separators are how people type them (8.000); only the digits are stored.
const wholeNumberSchema = (message: string) =>
	z
		.string()
		.transform((value) => value.replace(/\D/g, ''))
		.pipe(z.string().min(1, message))
		.transform(Number);

const REPLACEMENT_COST_MESSAGE = 'Escribe el costo en pesos enteros, mayor que cero';

// Blank is no cost, not zero: an unknown cost isn't guessed. Dots are thousands separators (95.000),
// so a comma, a minus sign or any other character is refused rather than silently dropped.
const replacementCostSchema = z
	.string()
	.optional()
	.transform((value) => value?.replace(/[\s$]/g, '') || undefined)
	.refine((value) => undefined === value || /^\d+(\.\d{3})*$/.test(value), REPLACEMENT_COST_MESSAGE)
	.transform((value) => (undefined === value ? undefined : Number(value.replace(/\./g, ''))))
	.refine((value) => undefined === value || 0 < value, REPLACEMENT_COST_MESSAGE);

// `variant_group` is the picker's existing group; `new_variant_group` is «Nuevo grupo»'s text.
const productSchema = z
	.object({
		name: z.string().trim().min(1, 'Escribe el nombre'),
		category: z.enum(CATEGORIES, 'Escoge la categoría'),
		variant_group: optionalTextSchema,
		new_variant_group: optionalTextSchema,
		variant_name: optionalTextSchema,
		description: z.string().optional(),
		website_url: websiteUrlSchema,
		replacement_cost: replacementCostSchema,
		rental_price: wholeNumberSchema('Escribe el precio por día').pipe(
			z.number().positive('El precio por día debe ser mayor que cero')
		),
		// The Activo and Inactivo radios; nothing posted reads as inactive, like an unchecked box.
		active: z
			.enum(['on', 'off'])
			.optional()
			.transform((value) => ('on' === value ? 1 : 0))
	})
	.transform((typed) => {
		const { new_variant_group, description, website_url, replacement_cost, ...columns } = typed;
		return {
			columns: {
				...columns,
				variant_group: new_variant_group ?? columns.variant_group,
				attributes: attributesJson({ description, website_url, replacement_cost })
			},
			isNewGroup: null !== new_variant_group
		};
	})
	.refine(({ columns }) => null === columns.variant_group || null !== columns.variant_name, {
		message: 'Escribe la variante',
		path: ['variant_name']
	})
	.refine(({ columns }) => null !== columns.variant_group || null === columns.variant_name, {
		message: 'Escoge el grupo de la variante',
		path: ['variant_group']
	});

type ParsedProduct = z.output<typeof productSchema>;

// Typed only on creation: after that only incidents, their reversals and counts change it.
const newProductSchema = productSchema.and(
	z.object({ total_quantity: wholeNumberSchema('Escribe la cantidad total') })
);

const idSchema = z.object({ id: z.coerce.number().int().positive() });

const PRODUCT_COLUMNS =
	'id, name, category, variant_group, variant_name, rental_price, total_quantity, active, attributes';

const SELECT_PRODUCT = `select ${PRODUCT_COLUMNS} from products`;

// Every write to `total_quantity` (create, edit, count, incident, their reversals) logs it in its
// event's `after`: the latest such event, or the creation for a seeded product with none.
const SELECT_LISTED_PRODUCT = `select ${PRODUCT_COLUMNS}, coalesce((select max(events.created_at) from events where events.entity_type = 'PRODUCT' and events.entity_id = products.id and json_extract(events.after, '$.total_quantity') is not null), products.created_at) as quantity_updated_at from products`;

function invalid(error: z.ZodError): Failure {
	const [issue] = error.issues;
	return { ok: false, message: issue.message, field: issue.path.join('.') };
}

function toProduct(row: ProductRow): Product {
	const attributes = productAttributesSchema.parse(JSON.parse(row.attributes));
	return {
		id: row.id,
		name: row.name,
		category: row.category,
		variantGroup: row.variant_group,
		variantName: row.variant_name,
		description: attributes.description ?? null,
		websiteUrl: attributes.website_url ?? null,
		replacementCost: attributes.replacement_cost ?? null,
		rentalPrice: row.rental_price,
		totalQuantity: row.total_quantity,
		isActive: 1 === row.active
	};
}

async function findRow(db: D1Database, id: number): Promise<ProductRow | null> {
	return db.prepare(`${SELECT_PRODUCT} where id = ?`).bind(id).first<ProductRow>();
}

async function groupExists(db: D1Database, group: string): Promise<boolean> {
	const row = await db
		.prepare('select 1 from products where variant_group = ? collate nocase')
		.bind(group)
		.first();
	return null !== row;
}

// A group is picked from the existing ones, so a typo never starts a phantom group.
async function findGroupProblem(
	db: D1Database,
	{ columns, isNewGroup }: ParsedProduct
): Promise<Failure | null> {
	if (null === columns.variant_group) {
		return null;
	}
	const exists = await groupExists(db, columns.variant_group);
	if (isNewGroup && exists) {
		const message = 'Ese grupo ya existe: escógelo de la lista';
		return { ok: false, message, field: 'new_variant_group' };
	}
	if (!isNewGroup && !exists) {
		return { ok: false, message: 'Escoge un grupo de la lista', field: 'variant_group' };
	}
	return null;
}

const DUPLICATE_VARIANT: Failure = {
	ok: false,
	message: 'Esa variante ya existe en el grupo',
	field: 'variant_name'
};

// The UNIQUE index is the check: its error is turned into a message on Variante, not a 500.
async function batchUnlessDuplicateVariant(
	db: D1Database,
	statements: D1PreparedStatement[]
): Promise<D1Result[] | null> {
	try {
		return await db.batch(statements);
	} catch (error) {
		if (String(error).includes('UNIQUE constraint failed: products.variant_group')) {
			return null;
		}
		throw error;
	}
}

// Filters come from the URL: an empty or tampered value is ignored, not an error.
const listSchema = z.object({
	search: z.string().trim().catch(''),
	category: z.enum(CATEGORIES).optional().catch(undefined)
});

export type ProductFilters = z.output<typeof listSchema>;

/** The filters come back parsed: what the screen shows as chosen is what was applied. */
export type ProductList = { products: ListedProduct[]; filters: ProductFilters };

function matches(product: Product, search: string): boolean {
	const { name, variantGroup, variantName } = product;
	return [name, variantGroup, variantName].some(
		(text) => null !== text && fold(text).includes(search)
	);
}

/** Every product, inactive ones included, by name, narrowed by text and category. */
export async function listProducts(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<ProductList> {
	requireRole(actor, POLICIES.products);
	const filters = listSchema.parse(input ?? {});
	const search = fold(filters.search);
	// ponytail: the whole catalog read, narrowed here so accents fold; SQL if it reaches thousands.
	const { results } = await db
		.prepare(SELECT_LISTED_PRODUCT)
		.all<ProductRow & { quantity_updated_at: number }>();
	const products = results
		.map((row) => ({ ...toProduct(row), quantityUpdatedAt: row.quantity_updated_at }))
		.filter(({ category }) => undefined === filters.category || category === filters.category)
		.filter((product) => matches(product, search))
		.sort((first, second) => first.name.localeCompare(second.name, 'es'));
	return { products, filters };
}

/** For the form's picker: a group is chosen from these, never typed again. */
export async function listVariantGroups(
	db: D1Database,
	actor: Actor | null
): Promise<VariantGroup[]> {
	requireRole(actor, POLICIES.manageProducts);
	// A group's variants share one category; should they differ, any of them pre-fills.
	const { results } = await db
		.prepare(
			'select variant_group as name, min(category) as category from products where variant_group is not null group by variant_group order by variant_group collate nocase'
		)
		.all<VariantGroup>();
	return results;
}

export async function getProduct(
	db: D1Database,
	id: number,
	actor: Actor | null
): Promise<Product | null> {
	requireRole(actor, POLICIES.manageProducts);
	const row = await findRow(db, id);
	return null === row ? null : toProduct(row);
}

export async function createProduct(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, POLICIES.manageProducts);
	const parsed = newProductSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const groupProblem = await findGroupProblem(db, parsed.data);
	if (null !== groupProblem) {
		return groupProblem;
	}
	const statements = auditedInsert(db, {
		table: 'products',
		entityType: 'PRODUCT',
		actor,
		values: { ...parsed.data.columns, total_quantity: parsed.data.total_quantity }
	});
	const results = await batchUnlessDuplicateVariant(db, statements);
	if (null === results) {
		return DUPLICATE_VARIANT;
	}
	return { ok: true, id: results[0].meta.last_row_id };
}

async function applyEdit(
	db: D1Database,
	actor: Actor,
	{ row, product }: { row: ProductRow; product: ParsedProduct }
): Promise<Result> {
	const { id, ...current } = row;
	const saved: Result = { ok: true, id };
	const statements = auditedUpdate(db, {
		table: 'products',
		entityType: 'PRODUCT',
		actor,
		id,
		current,
		changes: product.columns,
		jsonColumns: ['attributes']
	});
	if (0 === statements.length) {
		return saved;
	}
	const results = await batchUnlessDuplicateVariant(db, statements);
	return null === results ? DUPLICATE_VARIANT : saved;
}

/** Every field but `total_quantity`, `active` included: a product is deactivated, never deleted. */
export async function updateProduct(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, POLICIES.manageProducts);
	const parsedId = idSchema.safeParse(input);
	const parsed = productSchema.safeParse(input);
	if (!parsedId.success) {
		return invalid(parsedId.error);
	}
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const row = await findRow(db, parsedId.data.id);
	if (null === row) {
		return { ok: false, message: 'Ese producto no existe' };
	}
	const groupProblem = await findGroupProblem(db, parsed.data);
	if (null !== groupProblem) {
		return groupProblem;
	}
	return applyEdit(db, actor, { row, product: parsed.data });
}
