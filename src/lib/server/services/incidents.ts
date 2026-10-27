// Incidents: damage or loss found on an order's return, logged by whoever receives it. Each
// product carries its own outcome, and only what's gone (LOST, UNRECOVERABLE) leaves inventory:
// what's fixable stays rentable, and a partial count catches it if the repair fails.

import { z } from 'zod';
import { ROLES, requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate } from '../audit';
import { orderItemsSchema, type OrderStatus, type SaveResult } from './orders';

export const INCIDENT_OUTCOMES = ['LOST', 'UNRECOVERABLE', 'RECOVERABLE'] as const;
export const RESPONSIBLE_PARTIES = ['UNDETERMINED', 'CLIENT', 'CARRIER', 'COMPANY'] as const;
export const INCIDENT_STATUSES = ['ACTIVE', 'REVERSED'] as const;

export type IncidentOutcome = (typeof INCIDENT_OUTCOMES)[number];
export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** The outcomes that take the product out of inventory. */
const SUBTRACTING: readonly IncidentOutcome[] = ['LOST', 'UNRECOVERABLE'];

// Damage turns up on the return or later, washing: never before the order reaches the client.
const REPORTABLE: readonly OrderStatus[] = ['DELIVERED', 'OUT_FOR_PICKUP', 'COMPLETED'];

const idSchema = z.number().int().positive();
const qtySchema = z.number('Escribe la cantidad').int().min(1, 'La cantidad es al menos 1');
const outcomeSchema = z.enum(INCIDENT_OUTCOMES, 'Escoge qué pasó con el producto');

// 4 chairs lost and 3 recoverable fit in one incident; the same product and outcome twice don't.
function hasDistinctOutcomes(items: { product_id: number; outcome: IncidentOutcome }[]): boolean {
	const keys = items.map((item) => `${item.product_id}:${item.outcome}`);
	return new Set(keys).size === keys.length;
}

const ONE_ROW_PER_OUTCOME = 'Ese producto ya tiene ese resultado: cambia su cantidad';

// SQLite validates nothing: checked on write and on read. Each `name` is the order line's.
export const incidentItemsSchema = z
	.array(
		z.strictObject({
			product_id: idSchema,
			name: z.string().min(1),
			qty: qtySchema,
			outcome: outcomeSchema
		})
	)
	.min(1, 'Agrega al menos un producto')
	.refine(hasDistinctOutcomes, ONE_ROW_PER_OUTCOME);

export type IncidentItem = z.infer<typeof incidentItemsSchema>[number];

// What the report sends: the name comes from the order's line, never from the form.
const reportSchema = z.object({
	order_id: z.coerce.number().int().positive(),
	incident_description: z.string('Describe qué pasó').trim().min(1, 'Describe qué pasó'),
	items: z
		.array(z.strictObject({ product_id: idSchema, qty: qtySchema, outcome: outcomeSchema }))
		.min(1, 'Agrega al menos un producto')
});

type Refusal = Extract<SaveResult, { ok: false }>;

function refusal(errors: Record<string, string>, message = 'Revisa los campos marcados'): Refusal {
	return { ok: false, message, errors };
}

function invalid(error: z.ZodError): Refusal {
	return refusal(
		Object.fromEntries(error.issues.map((issue) => [issue.path.join('.'), issue.message]))
	);
}

type ReportInput = z.infer<typeof reportSchema>;

// Each product from the order's own lines, its name the line's, and per product the outcomes
// adding up to at most the line's quantity. A product deactivated since is still on the line.
function resolveItems(
	items: ReportInput['items'],
	lines: z.infer<typeof orderItemsSchema>
): IncidentItem[] | Refusal {
	const reported = new Map<number, number>();
	const errors: Record<string, string> = {};
	const resolved = items.map((item, index) => {
		const line = lines.find((each) => each.product_id === item.product_id);
		if (undefined === line) {
			errors[`items.${index}.product_id`] = 'Ese producto no está en el pedido';
			return { ...item, name: '' };
		}
		const total = (reported.get(item.product_id) ?? 0) + item.qty;
		reported.set(item.product_id, total);
		if (total > line.qty) {
			errors[`items.${index}.qty`] = `El pedido tiene ${line.qty}: no se pueden reportar más`;
		}
		return { ...item, name: line.name };
	});
	return 0 < Object.keys(errors).length ? refusal(errors) : resolved;
}

// How much each product leaves inventory: its LOST and UNRECOVERABLE quantities together.
function subtractions(items: IncidentItem[]): Map<number, number> {
	const totals = new Map<number, number>();
	for (const item of items.filter((each) => SUBTRACTING.includes(each.outcome))) {
		totals.set(item.product_id, (totals.get(item.product_id) ?? 0) + item.qty);
	}
	return totals;
}

// ponytail: read-then-write, so two incidents on one product in the same instant could lose one
// adjustment; `total_quantity - ?` in SQL if that ever happens. Nothing clamps it: it may go negative.
async function inventoryStatements(
	db: D1Database,
	actor: Actor,
	items: IncidentItem[]
): Promise<D1PreparedStatement[]> {
	const totals = subtractions(items);
	const { results } = await db
		.prepare('select id, total_quantity from products where id in (select value from json_each(?))')
		.bind(JSON.stringify([...totals.keys()]))
		.all<{ id: number; total_quantity: number }>();
	return results.flatMap(({ id, total_quantity: current }) =>
		auditedUpdate(db, {
			table: 'products',
			entityType: 'PRODUCT',
			action: 'INVENTORY_ADJUSTED',
			actor,
			id,
			current: { total_quantity: current },
			changes: { total_quantity: current - (totals.get(id) ?? 0) }
		})
	);
}

// Worked out, never set: whether an ACTIVE incident exists. No ORDER event on purpose: it isn't an
// edit, and logging one would mark a staged order «modified after staging».
function hasIncidentStatement(db: D1Database, orderId: number): D1PreparedStatement {
	return db
		.prepare(
			"update orders set has_incident = exists (select 1 from incidents where order_id = ? and status = 'ACTIVE') where id = ?"
		)
		.bind(orderId, orderId);
}

// The order must be with the client or back; the items, its own lines.
async function checkReport(db: D1Database, report: ReportInput): Promise<IncidentItem[] | Refusal> {
	const order = await db
		.prepare('select status, order_items from orders where id = ?')
		.bind(report.order_id)
		.first<{ status: OrderStatus; order_items: string }>();
	if (null === order) {
		return refusal({}, 'Ese pedido no existe');
	}
	if (!REPORTABLE.includes(order.status)) {
		return refusal({}, 'Una novedad se reporta cuando el pedido ya se entregó');
	}
	const lines = orderItemsSchema.parse(JSON.parse(order.order_items));
	const resolved = resolveItems(report.items, lines);
	if ('ok' in resolved) {
		return resolved;
	}
	const items = incidentItemsSchema.safeParse(resolved);
	return items.success ? items.data : refusal({ items: items.error.issues[0].message });
}

/**
 * Logs an incident on a delivered, out-for-pickup or completed order, open to every role. It's
 * born `UNDETERMINED`: whose fault it was is investigated later. The incident, the inventory it
 * takes, the order's flag and their events go in one batch.
 */
export async function reportIncident(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, ROLES);
	const parsed = reportSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const report = parsed.data;
	const items = await checkReport(db, report);
	if ('ok' in items) {
		return items;
	}
	const values = {
		order_id: report.order_id,
		incident_items: JSON.stringify(items),
		incident_description: report.incident_description,
		responsible_party: 'UNDETERMINED',
		status: 'ACTIVE'
	};
	const results = await db.batch([
		...auditedInsert(db, { table: 'incidents', entityType: 'INCIDENT', actor, values }),
		...(await inventoryStatements(db, actor, items)),
		hasIncidentStatement(db, report.order_id)
	]);
	return { ok: true, id: results[0].meta.last_row_id };
}
