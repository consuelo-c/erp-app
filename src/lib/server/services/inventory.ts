// Physical counts: a partial count of what the company owns, sent by whoever counts and applied
// only when `ADMIN` or `MANAGER` approves it. Sending touches no product.

import { z } from 'zod';
import { requireRole, type Actor, type Role } from '../actor';
import { auditedInsert, auditedUpdate, nowInSeconds } from '../audit';
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

/** Who reviews: approves, rejects, reverses, and counts and approves in one step. */
const REVIEWS: readonly Role[] = ['ADMIN', 'MANAGER'];

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

type ProductNow = { id: number; name: string; total_quantity: number };

// Each item's product as it is now, by id.
async function readProducts(
	db: D1Database,
	items: { product_id: number }[]
): Promise<Map<number, ProductNow>> {
	const { results } = await db
		.prepare(
			'select id, name, total_quantity from products where id in (select value from json_each(?))'
		)
		.bind(JSON.stringify(items.map((item) => item.product_id)))
		.all<ProductNow>();
	return new Map(results.map((product) => [product.id, product]));
}

// Each item's name frozen and `system_qty` snapshotted from the catalog now. An inactive product
// counts: the suggested list still shows one with a recoverable incident.
async function resolveItems(
	db: D1Database,
	items: z.infer<typeof countSchema>['items']
): Promise<InventoryItem[] | Refusal> {
	const products = await readProducts(db, items);
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

/**
 * The only rule for a stale item: its product's `total_quantity` changed since it was counted, so
 * applying the counted total now would undo that change.
 */
export function isStale(item: InventoryItem, currentTotal: number): boolean {
	return item.system_qty !== currentTotal;
}

/** Another pending count sharing products with this one: a warning, never a block. */
export type Overlap = { id: number; createdAt: number; createdBy: string; products: string[] };

export type ApprovalPreview = {
	/** Each applied item that changes its product: `from` → `to`. */
	changes: { product_id: number; name: string; from: number; to: number }[];
	/** Each item approval skips: what the system said when counted, and what it says now. */
	stale: { product_id: number; name: string; system_qty: number; current: number }[];
	overlaps: Overlap[];
};

type Plan = ApprovalPreview & { items: InventoryItem[]; products: Map<number, ProductNow> };

// The other pending counts (every one when `countId` is null) sharing products with `items`, each
// naming those products.
async function findOverlaps(
	db: D1Database,
	items: InventoryItem[],
	countId: number | null
): Promise<Overlap[]> {
	const { results } = await db
		.prepare(
			"select * from inventory_counts where status = 'PENDING_APPROVAL' and id is not ? and exists (select 1 from json_each(inventory_items) where json_extract(value, '$.product_id') in (select value from json_each(?))) order by id"
		)
		.bind(countId, JSON.stringify(items.map((item) => item.product_id)))
		.all<CountRow>();
	const names = new Map(items.map((item) => [item.product_id, item.name]));
	return results.map((row) => ({
		id: row.id,
		createdAt: row.created_at,
		createdBy: row.created_by,
		products: parseItems(row).flatMap((item) => names.get(item.product_id) ?? [])
	}));
}

// What approving would do to `items` now: each one applied or skipped against the current totals.
async function planApproval(
	db: D1Database,
	items: InventoryItem[],
	countId: number | null
): Promise<Plan> {
	const [products, overlaps] = await Promise.all([
		readProducts(db, items),
		findOverlaps(db, items, countId)
	]);
	const current = (item: InventoryItem) => products.get(item.product_id)?.total_quantity ?? 0;
	const planned = items.map((item) => ({ ...item, applied: !isStale(item, current(item)) }));
	const pick = (item: InventoryItem) => ({ product_id: item.product_id, name: item.name });
	return {
		items: planned,
		products,
		changes: planned
			.filter((item) => item.applied && item.counted_qty !== current(item))
			.map((item) => ({ ...pick(item), from: current(item), to: item.counted_qty })),
		stale: planned
			.filter((item) => !item.applied)
			.map((item) => ({ ...pick(item), system_qty: item.system_qty, current: current(item) })),
		overlaps
	};
}

type CountRow = {
	id: number;
	status: InventoryCountStatus;
	inventory_items: string;
	review_note: string | null;
	reviewed_by: string | null;
	reviewed_at: number | null;
	reversal_reason: string | null;
	reversed_by: string | null;
	reversed_at: number | null;
	created_at: number;
	created_by: string;
};

function parseItems(row: CountRow): InventoryItem[] {
	return inventoryItemsSchema.parse(JSON.parse(row.inventory_items));
}

const countIdSchema = z.coerce.number().int().positive();

// «Nota» is optional on both approving and rejecting: a blank one is none.
const noteSchema = z
	.string()
	.trim()
	.nullish()
	.transform((note) => note || null);

const reviewSchema = z.object({ id: countIdSchema, note: noteSchema });

// Only a pending count is reviewed: an approved, rejected or reversed one is read-only.
async function findPending(db: D1Database, id: number): Promise<CountRow | Refusal> {
	const row = await db
		.prepare('select * from inventory_counts where id = ?')
		.bind(id)
		.first<CountRow>();
	if (null === row) {
		return { ok: false, message: 'Ese conteo no existe', errors: {} };
	}
	return 'PENDING_APPROVAL' === row.status
		? row
		: { ok: false, message: 'Ese conteo ya fue revisado', errors: {} };
}

/**
 * What approving would apply, skip and overlap, for its confirmation: a pending count by `id`, or,
 * for «Guardar y aprobar», the `items` about to be sent. A missing or reviewed count is refused.
 */
export async function previewApproval(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<ApprovalPreview | Refusal> {
	requireRole(actor, REVIEWS);
	const byId = z.object({ id: countIdSchema }).safeParse(input);
	if (byId.success) {
		const row = await findPending(db, byId.data.id);
		return 'ok' in row ? row : toPreview(await planApproval(db, parseItems(row), row.id));
	}
	const parsed = countSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const items = await resolveItems(db, parsed.data.items);
	return 'ok' in items ? items : toPreview(await planApproval(db, items, null));
}

function toPreview({ changes, stale, overlaps }: Plan): ApprovalPreview {
	return { changes, stale, overlaps };
}

type Review = {
	row: CountRow;
	status: 'APPROVED' | 'REJECTED';
	note: string | null;
	items?: InventoryItem[];
};

// The review's own columns, logged as APPROVED or REJECTED with the note as the event's reason.
// Rejecting leaves the items as sent: no `applied` on them.
function reviewStatements(db: D1Database, actor: Actor, review: Review): D1PreparedStatement[] {
	const { row, status, note, items } = review;
	const current = {
		status: row.status,
		inventory_items: row.inventory_items,
		review_note: row.review_note,
		reviewed_by: row.reviewed_by,
		reviewed_at: row.reviewed_at
	};
	const changes = {
		status,
		inventory_items: items
			? JSON.stringify(inventoryItemsSchema.parse(items))
			: row.inventory_items,
		review_note: note,
		reviewed_by: actor.username,
		reviewed_at: nowInSeconds()
	};
	const write = { table: 'inventory_counts', entityType: 'INVENTORY_COUNT', id: row.id };
	return auditedUpdate(db, {
		...write,
		actor,
		action: status,
		current,
		changes,
		reason: note ?? undefined
	});
}

// Each applied item's product set to `counted_qty`: auditedUpdate writes nothing for one that
// already says so.
function adjustmentStatements(
	db: D1Database,
	actor: Actor,
	{ items, products }: Pick<Plan, 'items' | 'products'>
): D1PreparedStatement[] {
	return items
		.filter((item) => item.applied)
		.flatMap((item) =>
			auditedUpdate(db, {
				table: 'products',
				entityType: 'PRODUCT',
				action: 'INVENTORY_ADJUSTED',
				actor,
				id: item.product_id,
				current: { total_quantity: products.get(item.product_id)?.total_quantity ?? 0 },
				changes: { total_quantity: item.counted_qty }
			})
		);
}

// ponytail: read-then-write, so whatever moves a product between the read and the batch is lost:
// two counts sharing a product, approved at once, both pass the stale check and the second one
// overwrites the first instead of being skipped; an incident reported meanwhile is overwritten too
// (`reportIncident` also writes an absolute total). The same count approved twice only repeats its
// events. One manager reviews at a time; a conditional `update` per product if that ever changes.
async function approve(
	db: D1Database,
	{ row, note }: { row: CountRow; note: string | null },
	actor: Actor
): Promise<SaveResult> {
	const plan = await planApproval(db, parseItems(row), row.id);
	if (plan.items.every((item) => !item.applied)) {
		const message = 'Todos los productos están desactualizados: este conteo solo se puede rechazar';
		return { ok: false, message, errors: {} };
	}
	await db.batch([
		...reviewStatements(db, actor, { row, status: 'APPROVED', note, items: plan.items }),
		...adjustmentStatements(db, actor, plan)
	]);
	return { ok: true, id: row.id };
}

/**
 * Approves a pending count, `ADMIN` and `MANAGER` only: its stale items are skipped (`applied:
 * false`) and every other one sets its product's `total_quantity` to what was counted. A count
 * whose items are all stale can only be rejected. The count, its adjustments and their events go
 * in one batch.
 */
export async function approveCount(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, REVIEWS);
	const parsed = reviewSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const row = await findPending(db, parsed.data.id);
	return 'ok' in row ? row : approve(db, { row, note: parsed.data.note }, actor);
}

/** Rejects a pending count, `ADMIN` and `MANAGER` only: no product changes. */
export async function rejectCount(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, REVIEWS);
	const parsed = reviewSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const row = await findPending(db, parsed.data.id);
	if ('ok' in row) {
		return row;
	}
	await db.batch(reviewStatements(db, actor, { row, status: 'REJECTED', note: parsed.data.note }));
	return { ok: true, id: row.id };
}

/**
 * «Guardar y aprobar»: `ADMIN` or `MANAGER` counting sends the count and approves it, with them as
 * reviewer. Two writes, each its own batch, like a payroll draft and its payment: should approval
 * be refused, the count stays pending for review.
 */
export async function submitAndApproveCount(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, REVIEWS);
	const parsed = z.object({ note: noteSchema }).safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const sent = await submitCount(db, input, actor);
	if (!sent.ok) {
		return sent;
	}
	const row = await findPending(db, sent.id);
	return 'ok' in row ? row : approve(db, { row, note: parsed.data.note }, actor);
}

type ReversibleRow = CountRow & { approval: number | null };

// The count with its APPROVED event's id: the events log orders approvals and incidents exactly,
// where `reviewed_at` and `created_at` tie within a second.
function findReversible(db: D1Database, id: number): Promise<ReversibleRow | null> {
	return db
		.prepare(
			"select inventory_counts.*, (select max(id) from events where entity_type = 'INVENTORY_COUNT' and entity_id = inventory_counts.id and action = 'APPROVED') as approval from inventory_counts where id = ?"
		)
		.bind(id)
		.first<ReversibleRow>();
}

/**
 * The only rule for reversing a count's approval: why not, or null when it can. Only an approved
 * count, and only while its approval is still the last inventory movement of every product it
 * applied: no incident with that product `LOST` or `UNRECOVERABLE` reported or reversed after it,
 * no other count applying it approved after it, reversed since or not. Ordered by approval.
 */
async function reversalBlock(db: D1Database, row: ReversibleRow): Promise<string | null> {
	if ('APPROVED' !== row.status || null === row.approval) {
		return 'Solo se revierte un conteo aprobado';
	}
	const applied = parseItems(row).filter((item) => item.applied);
	const moved = await db
		.prepare(
			`select value as product_id from json_each(?1) as mine where exists (
				select 1 from events join incidents on incidents.id = events.entity_id, json_each(incidents.incident_items) as item
				where events.id > ?2 and events.entity_type = 'INCIDENT' and events.action in ('CREATED', 'REVERSED')
				and json_extract(item.value, '$.product_id') = mine.value and json_extract(item.value, '$.outcome') in ('LOST', 'UNRECOVERABLE')
			) or exists (
				select 1 from events join inventory_counts on inventory_counts.id = events.entity_id, json_each(inventory_counts.inventory_items) as item
				where events.id > ?2 and events.entity_type = 'INVENTORY_COUNT' and events.action = 'APPROVED'
				and json_extract(item.value, '$.product_id') = mine.value and json_extract(item.value, '$.applied') = 1
			) limit 1`
		)
		.bind(JSON.stringify(applied.map((item) => item.product_id)), row.approval)
		.first<{ product_id: number }>();
	const name = applied.find((item) => item.product_id === moved?.product_id)?.name;
	return undefined === name
		? null
		: `${name} ya tuvo otro movimiento de inventario después de este conteo`;
}

const reversalSchema = z.object({
	id: countIdSchema,
	reason: z.string('Escribe el motivo').trim().min(1, 'Escribe el motivo')
});

// The reversal's own columns, apart from the review's so the count keeps who approved it, and each
// applied item's product back to its `system_qty`.
async function reversalStatements(
	db: D1Database,
	actor: Actor,
	{ row, reason }: { row: CountRow; reason: string }
): Promise<D1PreparedStatement[]> {
	const items = parseItems(row);
	const restored = items.map((item) => ({ ...item, counted_qty: item.system_qty }));
	const current = {
		status: row.status,
		reversal_reason: null,
		reversed_by: null,
		reversed_at: null
	};
	const changes = {
		status: 'REVERSED',
		reversal_reason: reason,
		reversed_by: actor.username,
		reversed_at: nowInSeconds()
	};
	const write = { table: 'inventory_counts', entityType: 'INVENTORY_COUNT', action: 'REVERSED' };
	return [
		...auditedUpdate(db, { ...write, actor, id: row.id, current, changes, reason }),
		...adjustmentStatements(db, actor, { items: restored, products: await readProducts(db, items) })
	];
}

/**
 * Reverses an approved count, `ADMIN` and `MANAGER` only, with a required reason kept in the
 * event, while `reversalBlock` allows it: each applied item's product back to its `system_qty`,
 * the skipped ones untouched. The count, its adjustments and their events go in one batch.
 */
export async function reverseCount(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, REVIEWS);
	const parsed = reversalSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const { id, reason } = parsed.data;
	const row = await findReversible(db, id);
	if (null === row) {
		return { ok: false, message: 'Ese conteo no existe', errors: {} };
	}
	const block = await reversalBlock(db, row);
	if (null !== block) {
		return { ok: false, message: block, errors: {} };
	}
	await db.batch(await reversalStatements(db, actor, { row, reason }));
	return { ok: true, id };
}

/** A row of «Revisar conteo». The stale items and overlapping counts only for a pending one. */
export type CountSummary = {
	id: number;
	status: InventoryCountStatus;
	createdAt: number;
	createdBy: string;
	productCount: number;
	staleCount: number;
	overlapIds: number[];
};

type ParsedCount = { row: CountRow; items: InventoryItem[] };

// The pending counts' stale items, against the products now, and each one's other pending counts
// sharing a product.
async function pendingFlags(
	db: D1Database,
	pending: ParsedCount[]
): Promise<Map<number, Pick<CountSummary, 'staleCount' | 'overlapIds'>>> {
	const products = await readProducts(
		db,
		pending.flatMap(({ items }) => items)
	);
	const current = (item: InventoryItem) => products.get(item.product_id)?.total_quantity ?? 0;
	const shares = (mine: InventoryItem[], theirs: InventoryItem[]) =>
		mine.some((item) => theirs.some((other) => other.product_id === item.product_id));
	return new Map(
		pending.map(({ row, items }) => [
			row.id,
			{
				staleCount: items.filter((item) => isStale(item, current(item))).length,
				overlapIds: pending
					.filter((other) => other.row.id !== row.id && shares(items, other.items))
					.map((other) => other.row.id)
			}
		])
	);
}

/** «Revisar conteo», `ADMIN` and `MANAGER` only: the pending counts first, then the reviewed ones, each newest first. */
export async function listCounts(db: D1Database, actor: Actor | null): Promise<CountSummary[]> {
	requireRole(actor, REVIEWS);
	const { results } = await db
		.prepare("select * from inventory_counts order by status = 'PENDING_APPROVAL' desc, id desc")
		.all<CountRow>();
	const counts = results.map((row) => ({ row, items: parseItems(row) }));
	const flags = await pendingFlags(
		db,
		counts.filter(({ row }) => 'PENDING_APPROVAL' === row.status)
	);
	return counts.map(({ row, items }) => ({
		id: row.id,
		status: row.status,
		createdAt: row.created_at,
		createdBy: row.created_by,
		productCount: items.length,
		...(flags.get(row.id) ?? { staleCount: 0, overlapIds: [] })
	}));
}

export type CountDetail = {
	id: number;
	status: InventoryCountStatus;
	items: InventoryItem[];
	createdAt: number;
	createdBy: string;
	reviewNote: string | null;
	reviewedBy: string | null;
	reviewedAt: number | null;
	reversalReason: string | null;
	reversedBy: string | null;
	reversedAt: number | null;
	/** A pending count: what approving it now would apply, skip and overlap. */
	preview: ApprovalPreview | null;
	/** An approved count: why it can't be reversed, or null when it can. */
	reversalBlock: string | null;
};

/** One count, `ADMIN` and `MANAGER` only, or null when there's none. */
export async function getCount(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<CountDetail | null> {
	requireRole(actor, REVIEWS);
	const parsed = countIdSchema.safeParse(input);
	const row = parsed.success ? await findReversible(db, parsed.data) : null;
	if (null === row) {
		return null;
	}
	const items = parseItems(row);
	const isPending = 'PENDING_APPROVAL' === row.status;
	return {
		id: row.id,
		status: row.status,
		items,
		createdAt: row.created_at,
		createdBy: row.created_by,
		reviewNote: row.review_note,
		reviewedBy: row.reviewed_by,
		reviewedAt: row.reviewed_at,
		reversalReason: row.reversal_reason,
		reversedBy: row.reversed_by,
		reversedAt: row.reversed_at,
		preview: isPending ? toPreview(await planApproval(db, items, row.id)) : null,
		reversalBlock: 'APPROVED' === row.status ? await reversalBlock(db, row) : null
	};
}

/** A product to count: a recoverable incident no count has verified yet. */
export type SuggestedProduct = {
	product_id: number;
	name: string;
	total_quantity: number;
	/** The recoverable units across those incidents. */
	recoverable: number;
	/** Their orders, ascending. */
	order_ids: number[];
};

// Each product's latest approval that applied it, not reversed, and the recoverable units reported
// after it.
const SUGGESTED_SQL = `with verified as (
		select json_extract(item.value, '$.product_id') as product_id, max(events.id) as approval
		from inventory_counts join events on events.entity_type = 'INVENTORY_COUNT' and events.entity_id = inventory_counts.id and events.action = 'APPROVED', json_each(inventory_counts.inventory_items) as item
		where inventory_counts.status = 'APPROVED' and json_extract(item.value, '$.applied') = 1
		group by 1
	), pending as (
		select json_extract(item.value, '$.product_id') as product_id, json_extract(item.value, '$.qty') as qty, incidents.order_id
		from incidents join events on events.entity_type = 'INCIDENT' and events.entity_id = incidents.id and events.action = 'CREATED', json_each(incidents.incident_items) as item
		left join verified on verified.product_id = json_extract(item.value, '$.product_id')
		where incidents.status = 'ACTIVE' and json_extract(item.value, '$.outcome') = 'RECOVERABLE' and events.id > coalesce(verified.approval, 0)
	)
	select products.id as product_id, products.name, products.total_quantity, sum(pending.qty) as recoverable, json_group_array(distinct pending.order_id) as order_ids
	from pending join products on products.id = pending.product_id
	group by products.id order by products.name`;

/**
 * The only rule for the suggested list: each product with an `ACTIVE` incident holding a
 * `RECOVERABLE` item for it, reported after the last approved, not-reversed count that applied
 * that product (or any time, if none did), inactive products included. Per product: a count that
 * skipped it as stale verified nothing. Ordered by the `events` ids, like `reversalBlock`.
 */
export async function getSuggestedProducts(
	db: D1Database,
	actor: Actor | null
): Promise<SuggestedProduct[]> {
	requireRole(actor, COUNTS);
	const { results } = await db
		.prepare(SUGGESTED_SQL)
		.all<Omit<SuggestedProduct, 'order_ids'> & { order_ids: string }>();
	return results.map((row) => ({
		...row,
		order_ids: z
			.array(z.number())
			.parse(JSON.parse(row.order_ids))
			.sort((left, right) => left - right)
	}));
}

/**
 * «En alquiler», by product id: the lines of the orders out at events (`OUT_FOR_DELIVERY` through
 * `OUT_FOR_PICKUP`; a `PICKED` one is still on the shelf). An extension adds its lines only once
 * its original has left `DELIVERED` and `OUT_FOR_PICKUP`: until then the original's count them.
 */
export async function getUnitsOnRent(
	db: D1Database,
	actor: Actor | null
): Promise<Record<number, number>> {
	requireRole(actor, COUNTS);
	const { results } = await db
		.prepare(
			`select json_extract(line.value, '$.product_id') as product_id, sum(json_extract(line.value, '$.qty')) as qty
			from orders, json_each(orders.order_items) as line
			left join orders as original on original.id = json_extract(orders.attributes, '$.parent_order_id')
			where orders.status in ('OUT_FOR_DELIVERY', 'DELIVERED', 'OUT_FOR_PICKUP')
			and (original.id is null or original.status not in ('DELIVERED', 'OUT_FOR_PICKUP'))
			group by 1`
		)
		.all<{ product_id: number; qty: number }>();
	return Object.fromEntries(results.map((row) => [row.product_id, row.qty]));
}
