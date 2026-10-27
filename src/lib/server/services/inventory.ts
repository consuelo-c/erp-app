// Physical counts: a partial count of what the company owns, sent by whoever counts and applied
// only when `ADMIN` or `MANAGER` approves it. Sending touches no product.

import { z } from 'zod';
import { requireRole, type Actor, type Role } from '../actor';
import { auditedInsert } from '../audit';
import type { SaveResult } from './orders';

export const INVENTORY_COUNT_STATUSES = [
	'PENDING_APPROVAL',
	'APPROVED',
	'REJECTED',
	'REVERSED'
] as const;

export type InventoryCountStatus = (typeof INVENTORY_COUNT_STATUSES)[number];

/** Who counts: everyone but `SALES`. */
const COUNTS: readonly Role[] = ['ADMIN', 'MANAGER', 'WAREHOUSE', 'DRIVER'];

const idSchema = z.number().int().positive();
const countedSchema = z
	.number('Escribe la cantidad')
	.int('La cantidad es un número entero')
	.min(0, 'La cantidad es 0 o más');

const AT_LEAST_ONE = 'Escribe la cantidad de al menos un producto';

function hasDistinctProducts(items: { product_id: number }[]): boolean {
	return new Set(items.map((item) => item.product_id)).size === items.length;
}

const ONCE_PER_COUNT = 'Ese producto ya está en el conteo';

// SQLite validates nothing: checked on write and on read. `system_qty` is `total_quantity` when
// counted, negative included; `applied` stays unset until a review decides it.
export const inventoryItemsSchema = z
	.array(
		z.strictObject({
			product_id: idSchema,
			name: z.string().min(1),
			system_qty: z.number().int(),
			counted_qty: countedSchema,
			applied: z.boolean().nullish()
		})
	)
	.min(1, AT_LEAST_ONE)
	.refine(hasDistinctProducts, ONCE_PER_COUNT);

export type InventoryItem = z.infer<typeof inventoryItemsSchema>[number];

// What the count screen sends, its blank rows already left out: the name and the system's
// quantity come from the catalog, never from the form.
const countSchema = z.object({
	items: z
		.array(z.strictObject({ product_id: idSchema, counted_qty: countedSchema }))
		.min(1, AT_LEAST_ONE)
		.refine(hasDistinctProducts, ONCE_PER_COUNT)
});

type Refusal = Extract<SaveResult, { ok: false }>;

function invalid(error: z.ZodError): Refusal {
	const errors = Object.fromEntries(
		error.issues.map((issue) => [issue.path.join('.'), issue.message])
	);
	return { ok: false, message: 'Revisa los campos marcados', errors };
}

// Each item's name frozen and `system_qty` snapshotted from the catalog now. An inactive product
// counts: the suggested list still shows one with a recoverable incident.
async function resolveItems(
	db: D1Database,
	items: z.infer<typeof countSchema>['items']
): Promise<InventoryItem[] | Refusal> {
	const { results } = await db
		.prepare(
			'select id, name, total_quantity from products where id in (select value from json_each(?))'
		)
		.bind(JSON.stringify(items.map((item) => item.product_id)))
		.all<{ id: number; name: string; total_quantity: number }>();
	const products = new Map(results.map((product) => [product.id, product]));
	const errors: Record<string, string> = {};
	const resolved = items.map((item, index) => {
		const product = products.get(item.product_id);
		if (undefined === product) {
			errors[`items.${index}.product_id`] = 'Ese producto no existe';
		}
		return {
			product_id: item.product_id,
			name: product?.name ?? '',
			system_qty: product?.total_quantity ?? 0,
			counted_qty: item.counted_qty
		};
	});
	if (0 < Object.keys(errors).length) {
		return { ok: false, message: 'Revisa los campos marcados', errors };
	}
	return inventoryItemsSchema.parse(resolved);
}

/**
 * Sends a count `PENDING_APPROVAL`, open to everyone who counts. It changes no product: approving
 * applies it. Once sent it's never edited nor withdrawn.
 */
export async function submitCount(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, COUNTS);
	const parsed = countSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const items = await resolveItems(db, parsed.data.items);
	if ('ok' in items) {
		return items;
	}
	const values = { status: 'PENDING_APPROVAL', inventory_items: JSON.stringify(items) };
	const write = { table: 'inventory_counts', entityType: 'INVENTORY_COUNT', actor, values };
	const results = await db.batch(auditedInsert(db, write));
	return { ok: true, id: results[0].meta.last_row_id };
}
