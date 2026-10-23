// The rental catalog. A variant (one color of a tablecloth) is a complete product row with its own
// price and quantity; `variant_group` + `variant_name` only group it on the catalog screen.

import { z } from 'zod';
import { requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate } from '../audit';

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

// Sales quotes from the catalog; only the ones who run the business change it.
const VIEWS_PRODUCTS = ['ADMIN', 'MANAGER', 'SALES'] as const;
const MANAGES_PRODUCTS = ['ADMIN', 'MANAGER'] as const;

export type Product = {
	id: number;
	name: string;
	category: Category;
	variantGroup: string | null;
	variantName: string | null;
	description: string | null;
	rentalPrice: number;
	totalQuantity: number;
	isActive: boolean;
};

/** A variant group the form's picker offers, with the category its variants are in. */
export type VariantGroup = { name: string; category: Category };

type Failure = { ok: false; message: string; field?: string };
/** A save also says the product's group: the screen goes back to it. */
export type Result = { ok: true; id: number; variantGroup: string | null } | Failure;

type ProductRow = {
	id: number;
	name: string;
	category: Category; // the CHECK admits nothing else
	variant_group: string | null;
	variant_name: string | null;
	description: string | null;
	rental_price: number;
	total_quantity: number;
	active: number;
};

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

// `variant_group` is the picker's existing group; `new_variant_group` is «Nuevo grupo»'s text.
const productSchema = z
	.object({
		name: z.string().trim().min(1, 'Escribe el nombre'),
		category: z.enum(CATEGORIES, 'Escoge la categoría'),
		variant_group: optionalTextSchema,
		new_variant_group: optionalTextSchema,
		variant_name: optionalTextSchema,
		description: optionalTextSchema,
		rental_price: wholeNumberSchema('Escribe el precio por día').pipe(
			z.number().positive('El precio por día debe ser mayor que cero')
		),
		total_quantity: wholeNumberSchema('Escribe la cantidad total'),
		// The Activo and Inactivo radios; nothing posted reads as inactive, like an unchecked box.
		active: z
			.enum(['on', 'off'])
			.optional()
			.transform((value) => ('on' === value ? 1 : 0))
	})
	.transform((typed) => {
		const { new_variant_group, ...columns } = typed;
		return {
			columns: { ...columns, variant_group: new_variant_group ?? columns.variant_group },
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

const idSchema = z.object({ id: z.coerce.number().int().positive() });

const SELECT_PRODUCT =
	'select id, name, category, variant_group, variant_name, description, rental_price, total_quantity, active from products';

function invalid(error: z.ZodError): Failure {
	const [issue] = error.issues;
	return { ok: false, message: issue.message, field: issue.path.join('.') };
}

function toProduct(row: ProductRow): Product {
	return {
		id: row.id,
		name: row.name,
		category: row.category,
		variantGroup: row.variant_group,
		variantName: row.variant_name,
		description: row.description,
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
export type ProductList = { products: Product[]; filters: ProductFilters };

// «mantel» finds «Mantel», «cristaleria» finds «Cristalería».
function fold(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function matches(product: Product, search: string): boolean {
	const { name, variantGroup, variantName } = product;
	return [name, variantGroup, variantName].some(
		(text) => null !== text && fold(text).includes(search)
	);
}

/**
 * Every product, inactive ones included, by name, narrowed by text and category; the screen groups
 * them. A group is kept whole when its name or any of its variants matches: it's one row there.
 */
export async function listProducts(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<ProductList> {
	requireRole(actor, VIEWS_PRODUCTS);
	const filters = listSchema.parse(input ?? {});
	const search = fold(filters.search);
	// ponytail: the whole catalog read, narrowed here so accents fold; SQL if it reaches thousands.
	const { results } = await db.prepare(SELECT_PRODUCT).all<ProductRow>();
	const inCategory = results
		.map(toProduct)
		.filter(({ category }) => undefined === filters.category || category === filters.category);
	const found = inCategory.filter((product) => matches(product, search));
	const foundGroups = new Set(found.map(({ variantGroup }) => variantGroup).filter(Boolean));
	const products = inCategory
		.filter((product) => found.includes(product) || foundGroups.has(product.variantGroup))
		.sort((first, second) => first.name.localeCompare(second.name, 'es'));
	return { products, filters };
}

/** For the form's picker: a group is chosen from these, never typed again. */
export async function listVariantGroups(
	db: D1Database,
	actor: Actor | null
): Promise<VariantGroup[]> {
	requireRole(actor, MANAGES_PRODUCTS);
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
	requireRole(actor, MANAGES_PRODUCTS);
	const row = await findRow(db, id);
	return null === row ? null : toProduct(row);
}

export async function createProduct(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_PRODUCTS);
	const parsed = productSchema.safeParse(input);
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
		values: parsed.data.columns
	});
	const results = await batchUnlessDuplicateVariant(db, statements);
	if (null === results) {
		return DUPLICATE_VARIANT;
	}
	const { variant_group: variantGroup } = parsed.data.columns;
	return { ok: true, id: results[0].meta.last_row_id, variantGroup };
}

async function applyEdit(
	db: D1Database,
	actor: Actor,
	{ row, product }: { row: ProductRow; product: ParsedProduct }
): Promise<Result> {
	const { id, ...current } = row;
	const saved: Result = { ok: true, id, variantGroup: product.columns.variant_group };
	const statements = auditedUpdate(db, {
		table: 'products',
		entityType: 'PRODUCT',
		actor,
		id,
		current,
		changes: product.columns
	});
	if (0 === statements.length) {
		return saved;
	}
	const results = await batchUnlessDuplicateVariant(db, statements);
	return null === results ? DUPLICATE_VARIANT : saved;
}

/** Every field, `active` included: a product is deactivated, never deleted. */
export async function updateProduct(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_PRODUCTS);
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
