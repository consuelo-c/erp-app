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

type Failure = { ok: false; message: string; field?: string };
export type Result = { ok: true; id: number } | Failure;

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
		// An unchecked checkbox isn't posted at all.
		active: z
			.literal('on')
			.optional()
			.transform((value) => (undefined === value ? 0 : 1))
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

/** Every product, inactive ones included, by name; the screen groups them. */
export async function listProducts(db: D1Database, actor: Actor | null): Promise<Product[]> {
	requireRole(actor, VIEWS_PRODUCTS);
	const { results } = await db.prepare(SELECT_PRODUCT).all<ProductRow>();
	return results
		.map(toProduct)
		.sort((first, second) => first.name.localeCompare(second.name, 'es'));
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
	return null === results ? DUPLICATE_VARIANT : { ok: true, id: results[0].meta.last_row_id };
}

async function applyEdit(
	db: D1Database,
	actor: Actor,
	{ row, product }: { row: ProductRow; product: ParsedProduct }
): Promise<Result> {
	const { id, ...current } = row;
	const statements = auditedUpdate(db, {
		table: 'products',
		entityType: 'PRODUCT',
		actor,
		id,
		current,
		changes: product.columns
	});
	if (0 === statements.length) {
		return { ok: true, id };
	}
	const results = await batchUnlessDuplicateVariant(db, statements);
	return null === results ? DUPLICATE_VARIANT : { ok: true, id };
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
