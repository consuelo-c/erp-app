// Cuentas de cobro: a charge for one or more COMPLETED orders of one client. It stores its number,
// client, issue date and «Forma de pago»; its lines and totals are read live from its orders. Never
// deleted or voided: one issued with the wrong orders is fixed by editing them.

import { z } from 'zod';
import { getTodaysDate } from '$lib/datetime';
import { formatPesos } from '$lib/format';
import { parsePesos } from '$lib/payroll';
import { requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate, type Diff } from '../audit';
import { optional, recordLinkedMovement } from './cash';
import { contactAttributesSchema, isAutoDocument, searchClause } from './contacts';
import {
	BALANCE_DUE_SQL,
	invalidOrder,
	orderItemsSchema,
	RECEIVABLE_BALANCE_SQL,
	RECEIVABLE_PAID_MOVEMENT_SQL,
	RECEIVABLE_PAID_SQL,
	RECEIVABLE_TOTAL_SQL,
	searchTextSchema,
	toPayment,
	type OrderItem,
	type OrderPayment,
	type PaymentRow,
	type Refusal,
	type SaveResult
} from './orders';
import { COMPANY_SETTINGS, readSettings, type CompanySettings } from './settings';

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
	event_date: string;
	order_total: number;
	balance_due: number;
};

type ReceivableRow = { id: number; client_id: number; attributes: string };

const NOT_FOUND: Refusal = { ok: false, message: 'Esa cuenta de cobro no existe', errors: {} };

const NOT_ELIGIBLE_MESSAGE =
	'Solo se incluyen pedidos completados de este cliente, sin pagos parciales ni otra cuenta de cobro';

const NOT_ELIGIBLE: Refusal = {
	ok: false,
	message: NOT_ELIGIBLE_MESSAGE,
	errors: { orders: NOT_ELIGIBLE_MESSAGE }
};

/**
 * The client's COMPLETED orders with no cuenta, or already in `receivableId`, which is null when
 * issuing a new one. `canJoin` says which of them a cuenta de cobro can bill.
 */
async function findEligibleOrders(
	db: D1Database,
	{ clientId, receivableId }: { clientId: number; receivableId: number | null }
): Promise<EligibleOrder[]> {
	const { results } = await db
		.prepare(
			`select id, client_id, status, receivable_id, event_date, order_total,
			${BALANCE_DUE_SQL} as balance_due from orders
			where client_id = ? and status = 'COMPLETED' and (receivable_id is null or receivable_id = ?)
			order by event_date, id`
		)
		.bind(clientId, receivableId)
		.all<EligibleOrder>();
	return results;
}

// An order joins unpaid or fully paid, never partly paid; one already in the cuenta stays.
function canJoin(order: EligibleOrder): boolean {
	const isPartlyPaid = 0 < order.balance_due && order.balance_due < order.order_total;
	return null !== order.receivable_id || !isPartlyPaid;
}

function isEveryOrderEligible(orderIds: number[], eligible: EligibleOrder[]): boolean {
	return orderIds.every((id) => eligible.some((order) => order.id === id && canJoin(order)));
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

const paymentInputSchema = z.object({ id: idSchema, amount: z.string().default('') });

// A cuenta is paid once and in full: only its whole balance, and nothing once it's paid.
async function paymentRefusal(
	db: D1Database,
	receivableId: number,
	typedAmount: string
): Promise<Refusal | null> {
	const row = await db
		.prepare(`select ${RECEIVABLE_BALANCE_SQL} as balance from receivables where id = ?`)
		.bind(receivableId)
		.first<{ balance: number }>();
	const balance = row?.balance ?? 0;
	if (balance <= 0) {
		return { ok: false, message: 'Esta cuenta de cobro ya está pagada.', errors: {} };
	}
	if (parsePesos(typedAmount) === balance) {
		return null;
	}
	const message = `La cuenta de cobro se paga completa: ${formatPesos(balance)}.`;
	return { ok: false, message, errors: {} };
}

/**
 * «Registrar pago»: one movement on the cuenta, never split across its orders, whatever the form
 * posts as its concept. `payee` copies the client's current name.
 */
export async function recordReceivablePayment(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, MANAGES_RECEIVABLES);
	const parsed = paymentInputSchema.safeParse(input);
	if (!parsed.success) {
		return NOT_FOUND;
	}
	const row = await findRow(db, parsed.data.id);
	if (null === row) {
		return NOT_FOUND;
	}
	const refusal = await paymentRefusal(db, row.id, parsed.data.amount);
	if (null !== refusal) {
		return refusal;
	}
	const { name: payee } = await findClient(db, row.client_id);
	const link = {
		concept: 'INSTALLMENT',
		entityType: 'RECEIVABLE',
		entityId: row.id,
		payee
	} as const;
	return recordLinkedMovement(db, { form: input, ...link }, actor);
}

export type ReceivablePayment = OrderPayment & {
	/** The order it was recorded on, or null when it's the cuenta's own. */
	orderId: number | null;
};

export type ReceivableOrder = { id: number; eventDate: string; orderTotal: number };

export type ReceivableClient = {
	name: string;
	phone: string;
	/** Null when it's automatic. */ documentId: string | null;
};

export type ReceivableDetail = {
	id: number;
	issueDate: string;
	paymentTerms: string;
	client: ReceivableClient;
	orders: ReceivableOrder[];
	payments: ReceivablePayment[];
	total: number;
	paid: number;
	balance: number;
};

type ClientRow = { full_name: string; phone: string; document_id: string };

type DetailRow = ClientRow & {
	id: number;
	issue_date: string;
	attributes: string;
	contact_attributes: string;
	total: number;
	paid: number;
	balance: number;
};

async function findDetailRow(db: D1Database, id: number): Promise<DetailRow | null> {
	return db
		.prepare(
			`select receivables.id, issue_date, receivables.attributes, full_name, phone, document_id,
			contacts.attributes as contact_attributes,
			${RECEIVABLE_TOTAL_SQL} as total, ${RECEIVABLE_PAID_SQL} as paid,
			${RECEIVABLE_BALANCE_SQL} as balance
			from receivables join contacts on contacts.id = receivables.client_id
			where receivables.id = ?`
		)
		.bind(id)
		.first<DetailRow>();
}

async function findOrders(db: D1Database, id: number): Promise<ReceivableOrder[]> {
	const { results } = await db
		.prepare(
			`select id, event_date as eventDate, order_total as orderTotal from orders
			where receivable_id = ? order by id`
		)
		.bind(id)
		.all<ReceivableOrder>();
	return results;
}

async function findPayments(db: D1Database, id: number): Promise<ReceivablePayment[]> {
	const { results } = await db
		.prepare(
			`select cash_movements.id, movement_date, concept, amount, payment_method,
			json_extract(cash_movements.attributes, '$.other_method') as other_method, payee,
			receipt_number, iif('ORDER' = entity_type, entity_id, null) as order_id
			from cash_movements join receivables on receivables.id = ?
			where ${RECEIVABLE_PAID_MOVEMENT_SQL}
			order by movement_date, cash_movements.id`
		)
		.bind(id)
		.all<PaymentRow & { order_id: number | null }>();
	return results.map((row) => ({ ...toPayment(row), orderId: row.order_id }));
}

function toClient(row: ClientRow): ReceivableClient {
	return {
		name: row.full_name,
		phone: row.phone,
		documentId: isAutoDocument(row.document_id) ? null : row.document_id
	};
}

function toDetail(row: DetailRow): Omit<ReceivableDetail, 'orders' | 'payments'> {
	const attributes = receivableAttributesSchema.parse(JSON.parse(row.attributes));
	return {
		id: row.id,
		issueDate: row.issue_date,
		paymentTerms: attributes.payment_terms,
		client: toClient(row),
		total: row.total,
		paid: row.paid,
		balance: row.balance
	};
}

/** The detail screen: its fields, orders, payments, oldest first, and balance. Null if there's none. */
export async function getReceivableDetail(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<ReceivableDetail | null> {
	requireRole(actor, MANAGES_RECEIVABLES);
	const parsedId = idSchema.safeParse(id);
	if (!parsedId.success) {
		return null;
	}
	const [row, orders, payments] = await Promise.all([
		findDetailRow(db, parsedId.data),
		findOrders(db, parsedId.data),
		findPayments(db, parsedId.data)
	]);
	if (null === row) {
		return null;
	}
	return { ...toDetail(row), orders, payments };
}

export type PrintedOrder = {
	id: number;
	items: OrderItem[];
	itemsTotal: number;
	rentalDays: number;
	discount: number;
	transportCost: number;
	orderTotal: number;
};

export type ReceivablePrintout = {
	id: number;
	issueDate: string;
	paymentTerms: string;
	client: ReceivableClient & { address: string };
	orders: PrintedOrder[];
	total: number;
	company: CompanySettings;
};

type PrintedOrderRow = Omit<PrintedOrder, 'items'> & { order_items: string };

async function findPrintedOrders(db: D1Database, id: number): Promise<PrintedOrder[]> {
	const { results } = await db
		.prepare(
			`select id, order_items, items_total as itemsTotal, rental_days as rentalDays, discount,
			transport_cost as transportCost, order_total as orderTotal from orders
			where receivable_id = ? order by id`
		)
		.bind(id)
		.all<PrintedOrderRow>();
	return results.map(({ order_items: orderItems, ...order }) => ({
		...order,
		items: orderItemsSchema.parse(JSON.parse(orderItems))
	}));
}

function toAddress(contactAttributes: string): string {
	const { address_1, address_2 } = contactAttributesSchema.parse(JSON.parse(contactAttributes));
	return [address_1, address_2].filter(Boolean).join(', ');
}

/** The letter sheets: the client is read live from the contact. Null if there's no such cuenta. */
export async function getReceivablePrintout(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<ReceivablePrintout | null> {
	requireRole(actor, MANAGES_RECEIVABLES);
	const parsedId = idSchema.safeParse(id);
	if (!parsedId.success) {
		return null;
	}
	const [row, orders, company] = await Promise.all([
		findDetailRow(db, parsedId.data),
		findPrintedOrders(db, parsedId.data),
		readSettings(db, COMPANY_SETTINGS)
	]);
	if (null === row) {
		return null;
	}
	const { id: receivableId, issueDate, paymentTerms, client, total } = toDetail(row);
	return {
		id: receivableId,
		issueDate,
		paymentTerms,
		client: { ...client, address: toAddress(row.contact_attributes) },
		orders,
		total,
		company
	};
}

/** A row of the form's checklist: one that can't join reads as such, and can't be checked. */
export type ReceivableFormOrder = ReceivableOrder & { canJoin: boolean };

export type ReceivableForm = {
	client: ReceivableClient;
	/** The checklist, by event date. */ orders: ReceivableFormOrder[];
	checkedOrderIds: number[];
	paymentTerms: string;
};

async function findClient(db: D1Database, clientId: number): Promise<ReceivableClient> {
	const row = await db
		.prepare('select full_name, phone, document_id from contacts where id = ?')
		.bind(clientId)
		.first<ClientRow>();
	if (null === row) {
		throw new Error(`Contact ${clientId} is gone: contacts are never deleted`);
	}
	return toClient(row);
}

function toFormOrder(order: EligibleOrder): ReceivableFormOrder {
	return {
		id: order.id,
		eventDate: order.event_date,
		orderTotal: order.order_total,
		canJoin: canJoin(order)
	};
}

/**
 * The form to issue a cuenta from an order, which comes checked. Null when that order can't start
 * one: it doesn't exist, isn't COMPLETED, is partly paid or is already billed.
 */
export async function getReceivableIssueForm(
	db: D1Database,
	orderId: unknown,
	actor: Actor | null
): Promise<ReceivableForm | null> {
	requireRole(actor, MANAGES_RECEIVABLES);
	const parsedId = idSchema.safeParse(orderId);
	if (!parsedId.success) {
		return null;
	}
	const clientId = await findClientOf(db, parsedId.data);
	if (null === clientId) {
		return null;
	}
	const eligible = await findEligibleOrders(db, { clientId, receivableId: null });
	if (!isEveryOrderEligible([parsedId.data], eligible)) {
		return null;
	}
	return {
		client: await findClient(db, clientId),
		orders: eligible.map(toFormOrder),
		checkedOrderIds: [parsedId.data],
		paymentTerms: 'Contado'
	};
}

/** The form to edit a cuenta: its orders checked, the client's other eligible ones not. */
export async function getReceivableEditForm(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<ReceivableForm | null> {
	requireRole(actor, MANAGES_RECEIVABLES);
	const parsedId = idSchema.safeParse(id);
	if (!parsedId.success) {
		return null;
	}
	const row = await findRow(db, parsedId.data);
	if (null === row) {
		return null;
	}
	const eligible = await findEligibleOrders(db, {
		clientId: row.client_id,
		receivableId: row.id
	});
	return {
		client: await findClient(db, row.client_id),
		orders: eligible.map(toFormOrder),
		checkedOrderIds: eligible
			.filter((order) => row.id === order.receivable_id)
			.map(({ id: orderId }) => orderId),
		paymentTerms: receivableAttributesSchema.parse(JSON.parse(row.attributes)).payment_terms
	};
}

/** A page of the list: it never loads the whole table. */
export const RECEIVABLES_PAGE_SIZE = 20;

// `page` past the last one shows the last: a typed URL is tolerated like any other filter.
const listSchema = z.object({
	text: optional(searchTextSchema),
	hasBalance: optional(z.literal('1').transform(() => true)),
	page: z.coerce.number().int().min(1).catch(1)
});

export type ReceivableFilters = z.output<typeof listSchema>;

export type ReceivableSummary = {
	id: number;
	clientName: string;
	issueDate: string;
	total: number;
	/** Negative is the client's credit. */
	balance: number;
};

/** The filters come back parsed, `page` clamped: what the screen shows is what was applied. */
export type ReceivablePage = {
	receivables: ReceivableSummary[];
	total: number;
	pageCount: number;
	filters: ReceivableFilters;
};

// The order list's search, over the contact: a cuenta freezes no client, and prints the current one.
function listClauses(filters: ReceivableFilters) {
	const search = undefined === filters.text ? null : searchClause(filters.text);
	const pending = filters.hasBalance
		? { sql: `(${RECEIVABLE_BALANCE_SQL}) > 0`, params: [] }
		: null;
	return [search, pending].filter((clause) => null !== clause);
}

/** One page of cuentas de cobro, newest first, narrowed by every filter at once. */
export async function listReceivables(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<ReceivablePage> {
	requireRole(actor, MANAGES_RECEIVABLES);
	const parsed = listSchema.parse(input ?? {});
	const clauses = listClauses(parsed);
	const where = clauses.map(({ sql }) => `(${sql})`).join(' and ') || '1';
	const params = clauses.flatMap((clause) => clause.params);
	const source = `from receivables join contacts on contacts.id = receivables.client_id
		where ${where}`;
	const count = await db
		.prepare(`select count(*) as total ${source}`)
		.bind(...params)
		.first<{ total: number }>();
	const total = count?.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / RECEIVABLES_PAGE_SIZE));
	const filters = { ...parsed, page: Math.min(parsed.page, pageCount) };
	const { results } = await db
		.prepare(
			`select receivables.id, full_name as clientName, issue_date as issueDate,
			${RECEIVABLE_TOTAL_SQL} as total, ${RECEIVABLE_BALANCE_SQL} as balance
			${source} order by receivables.id desc limit ? offset ?`
		)
		.bind(...params, RECEIVABLES_PAGE_SIZE, (filters.page - 1) * RECEIVABLES_PAGE_SIZE)
		.all<ReceivableSummary>();
	return { receivables: results, total, pageCount, filters };
}
