// Cuentas de cobro: a charge for one or more COMPLETED orders of one client. It stores its number,
// client, issue date and «Forma de pago»; its lines and totals are read live from its orders. Never
// deleted or voided: one issued with the wrong orders is fixed by editing them.

import { z } from 'zod';
import { getTodaysDate } from '$lib/datetime';
import { requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate, type Diff } from '../audit';
import { invalidOrder, type Refusal, type SaveResult } from './orders';

const MANAGES_RECEIVABLES = ['ADMIN', 'MANAGER'] as const;

const paymentTermsSchema = z.string().trim().min(1, 'Escribe la forma de pago');

export const receivableAttributesSchema = z.strictObject({ payment_terms: paymentTermsSchema });

const idSchema = z.coerce.number().int().positive();

const issueInputSchema = z.object({
	orders: z
		.array(idSchema)
		.min(1, 'Marca al menos un pedido')
		.transform((ids) => [...new Set(ids)]),
	payment_terms: paymentTermsSchema
});

const editInputSchema = issueInputSchema.extend({ id: idSchema });

type EligibleOrder = {
	id: number;
	client_id: number;
	status: string;
	receivable_id: number | null;
};

type ReceivableRow = { id: number; client_id: number; attributes: string };

const NOT_FOUND: Refusal = { ok: false, message: 'Esa cuenta de cobro no existe', errors: {} };

const NOT_ELIGIBLE_MESSAGE =
	'Solo se incluyen pedidos completados de este cliente, sin otra cuenta de cobro';

const NOT_ELIGIBLE: Refusal = {
	ok: false,
	message: NOT_ELIGIBLE_MESSAGE,
	errors: { orders: NOT_ELIGIBLE_MESSAGE }
};

/**
 * The one rule for what a cuenta de cobro can bill: the client's COMPLETED orders with no cuenta, or
 * already in `receivableId`, which is null when issuing a new one.
 */
async function findEligibleOrders(
	db: D1Database,
	{ clientId, receivableId }: { clientId: number; receivableId: number | null }
): Promise<EligibleOrder[]> {
	const { results } = await db
		.prepare(
			`select id, client_id, status, receivable_id from orders
			where client_id = ? and status = 'COMPLETED' and (receivable_id is null or receivable_id = ?)
			order by event_date, id`
		)
		.bind(clientId, receivableId)
		.all<EligibleOrder>();
	return results;
}

function isEveryOrderEligible(orderIds: number[], eligible: EligibleOrder[]): boolean {
	return orderIds.every((id) => eligible.some((order) => order.id === id));
}

async function findClientOf(db: D1Database, orderId: number): Promise<number | null> {
	const row = await db
		.prepare('select client_id from orders where id = ?')
		.bind(orderId)
		.first<{ client_id: number }>();
	return row?.client_id ?? null;
}

function toAttributes(paymentTerms: string): string {
	return JSON.stringify(receivableAttributesSchema.parse({ payment_terms: paymentTerms }));
}

// An array can't go in `events`: it's logged as JSON text, as the JSON columns are.
function toLoggedIds(orderIds: number[]): string {
	return JSON.stringify([...orderIds].sort((first, second) => first - second));
}

type IssuedReceivable = {
	clientId: number;
	paymentTerms: string;
	orders: EligibleOrder[];
};

// The cuenta's id from the highest one, not `last_insert_rowid()`: by now that's its event's. Inside
// the atomic batch it's the row just inserted, since AUTOINCREMENT never hands out a lower one.
function issueStatements(db: D1Database, actor: Actor, issued: IssuedReceivable) {
	const insert = auditedInsert(db, {
		table: 'receivables',
		entityType: 'RECEIVABLE',
		actor,
		values: {
			client_id: issued.clientId,
			issue_date: getTodaysDate(),
			attributes: toAttributes(issued.paymentTerms)
		},
		logged: { order_ids: toLoggedIds(issued.orders.map(({ id }) => id)) }
	});
	const links = issued.orders.flatMap((order) =>
		auditedUpdate(db, {
			table: 'orders',
			entityType: 'ORDER',
			actor,
			id: order.id,
			current: order,
			changes: {},
			computed: {
				receivable_id: { sql: 'select max(id) from receivables', params: [], isLogged: true }
			},
			action: 'RECEIVABLE_LINKED'
		})
	);
	return [...insert, ...links];
}

/**
 * «Emitir cuenta de cobro»: the row, each checked order linked to it, and their events, in one batch.
 * Its client is the orders': the first one's, which the others must share.
 */
export async function issueReceivable(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, MANAGES_RECEIVABLES);
	const parsed = issueInputSchema.safeParse(input);
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	const { orders: orderIds, payment_terms: paymentTerms } = parsed.data;
	const clientId = await findClientOf(db, orderIds[0]);
	if (null === clientId) {
		return NOT_ELIGIBLE;
	}
	const eligible = await findEligibleOrders(db, { clientId, receivableId: null });
	if (!isEveryOrderEligible(orderIds, eligible)) {
		return NOT_ELIGIBLE;
	}
	const orders = eligible.filter(({ id }) => orderIds.includes(id));
	// ponytail: two saves racing on one order both pass the check above; a guarded link if it ever happens.
	const results = await db.batch(issueStatements(db, actor, { clientId, paymentTerms, orders }));
	return { ok: true, id: results[0].meta.last_row_id };
}

async function findRow(db: D1Database, id: number): Promise<ReceivableRow | null> {
	const row = await db
		.prepare('select id, client_id, attributes from receivables where id = ?')
		.bind(id)
		.first<ReceivableRow>();
	if (null !== row) {
		receivableAttributesSchema.parse(JSON.parse(row.attributes));
	}
	return row;
}

type ReceivableEdit = {
	row: ReceivableRow;
	paymentTerms: string;
	joining: EligibleOrder[];
	leaving: EligibleOrder[];
	loggedOrders: Diff;
};

function orderLinkStatements(db: D1Database, actor: Actor, edit: ReceivableEdit) {
	const link = (order: EligibleOrder, receivableId: number | null, action: string) =>
		auditedUpdate(db, {
			table: 'orders',
			entityType: 'ORDER',
			actor,
			id: order.id,
			current: order,
			changes: { receivable_id: receivableId },
			action
		});
	return [
		...edit.joining.flatMap((order) => link(order, edit.row.id, 'RECEIVABLE_LINKED')),
		...edit.leaving.flatMap((order) => link(order, null, 'RECEIVABLE_UNLINKED'))
	];
}

function editStatements(db: D1Database, actor: Actor, edit: ReceivableEdit) {
	const update = auditedUpdate(db, {
		table: 'receivables',
		entityType: 'RECEIVABLE',
		actor,
		id: edit.row.id,
		current: edit.row,
		changes: { attributes: toAttributes(edit.paymentTerms) },
		jsonColumns: ['attributes'],
		logged: edit.loggedOrders
	});
	return [...update, ...orderLinkStatements(db, actor, edit)];
}

type EditRequest = { orderIds: number[]; paymentTerms: string; eligible: EligibleOrder[] };

function planEdit(
	row: ReceivableRow,
	{ orderIds, paymentTerms, eligible }: EditRequest
): ReceivableEdit {
	const current = eligible.filter((order) => row.id === order.receivable_id);
	const joining = eligible.filter(
		(order) => orderIds.includes(order.id) && row.id !== order.receivable_id
	);
	const leaving = current.filter((order) => !orderIds.includes(order.id));
	const isSameOrders = 0 === joining.length + leaving.length;
	const loggedOrders: Diff = isSameOrders
		? { before: {}, after: {} }
		: {
				before: { order_ids: toLoggedIds(current.map(({ id }) => id)) },
				after: { order_ids: toLoggedIds(orderIds) }
			};
	return { row, paymentTerms, joining, leaving, loggedOrders };
}

/**
 * «Editar»: its orders and «Forma de pago», in one batch. The number, the client and the issue date
 * never change. A save that changes nothing writes nothing.
 */
export async function updateReceivable(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, MANAGES_RECEIVABLES);
	const parsed = editInputSchema.safeParse(input);
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	const { id, orders: orderIds, payment_terms: paymentTerms } = parsed.data;
	const row = await findRow(db, id);
	if (null === row) {
		return NOT_FOUND;
	}
	const eligible = await findEligibleOrders(db, { clientId: row.client_id, receivableId: id });
	if (!isEveryOrderEligible(orderIds, eligible)) {
		return NOT_ELIGIBLE;
	}
	const edit = planEdit(row, { orderIds, paymentTerms, eligible });
	const statements = editStatements(db, actor, edit);
	if (0 < statements.length) {
		await db.batch(statements);
	}
	return { ok: true, id };
}
