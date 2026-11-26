// Reportes: read-only views over what the other modules recorded. Nothing here writes a row or an
// Event; each reader checks its roles and parses its filters like any other list.

import { z } from 'zod';
import { resolve } from '$app/paths';
import { addDays, getDayStartInstant, getMonthRange, getTodaysDate } from '$lib/datetime';
import { POLICIES } from '$lib/roles';
import { requireRole, type Actor } from '../actor';
import { eventFieldsSchema } from '../audit';
import { optional, paginate } from '../query';
import { type CashConcept } from './cash';
import { DAMAGE_CHARGED_SQL, HELD_LINES_SQL } from './orders';

/** Every `events.entity_type` the app writes: Auditoría's «Registro». */
export const EVENT_ENTITY_TYPES = [
	'ORDER',
	'QUOTE',
	'CONTACT',
	'PRODUCT',
	'USER',
	'EMPLOYEE',
	'TIMESHEET',
	'PAYROLL_RUN',
	'CASH_MOVEMENT',
	'CASH_HANDOVER',
	'RECEIVABLE',
	'INCIDENT',
	'INVENTORY_COUNT',
	'SETTINGS'
] as const;

export type EventEntityType = (typeof EVENT_ENTITY_TYPES)[number];

/** The `events.action` values Auditoría's «Acción» offers, each with a Spanish label. */
export const EVENT_ACTIONS = [
	'CREATED',
	'EDITED',
	'STATUS_CHANGED',
	'CANCELLED',
	'CONVERTED',
	'PAID',
	'REVERSED',
	'CLEARED',
	'INVENTORY_ADJUSTED',
	'RECEIVABLE_LINKED',
	'PASSWORD_SET',
	'LOGIN',
	'LOGIN_FAILED',
	'LOGOUT'
] as const;

export type EventAction = (typeof EVENT_ACTIONS)[number];

/** A page of Auditoría: it never loads the whole log. */
export const AUDIT_LOG_PAGE_SIZE = 20;

// Every filter optional and exact; an unreadable value is «all», a page past the last the last.
const auditLogSchema = z.object({
	from: optional(z.iso.date()),
	to: optional(z.iso.date()),
	username: optional(z.string().min(1)),
	entityType: optional(z.enum(EVENT_ENTITY_TYPES)),
	action: optional(z.enum(EVENT_ACTIONS)),
	page: z.coerce.number().int().min(1).catch(1)
});

export type AuditLogFilters = z.output<typeof auditLogSchema>;

type FieldValue = string | number | null;

/** One changed field, with its raw column name and stored values; null where it had none. */
export type FieldChange = { column: string; before: FieldValue; after: FieldValue };

export type RecordLink = { href: string; label: string };

export type AuditEvent = {
	id: number;
	createdAt: number;
	username: string;
	/** Raw: one of `EVENT_ENTITY_TYPES` in practice, shown raw when it has no label. */
	entityType: string;
	entityId: number | null;
	entityKey: string | null;
	action: string;
	changes: FieldChange[];
	reason: string | null;
	ip: string | null;
	userAgent: string | null;
	/** The record's page, or null when its type has none: «sin página». */
	link: RecordLink | null;
};

/** The filters come back parsed, `page` clamped: what the screen shows as chosen is what was applied. */
export type AuditLog = {
	events: AuditEvent[];
	total: number;
	pageCount: number;
	filters: AuditLogFilters;
	/** Every username in the log, sorted: deleted, renamed and mistyped ones too. */
	usernames: string[];
};

type Clause = { sql: string; params: (string | number)[] };

// Each Bogotá day runs from its midnight to the next one's, so `to` is inclusive.
function auditLogClauses({ from, to, username, entityType, action }: AuditLogFilters): Clause[] {
	const candidates: (Clause | null)[] = [
		from ? { sql: 'created_at >= ?', params: [getDayStartInstant(from)] } : null,
		to ? { sql: 'created_at < ?', params: [getDayStartInstant(addDays(to, 1))] } : null,
		username ? { sql: 'actor_username = ?', params: [username] } : null,
		entityType ? { sql: 'entity_type = ?', params: [entityType] } : null,
		action ? { sql: 'action = ?', params: [action] } : null
	];
	return candidates.filter((clause) => null !== clause);
}

// The record's readable name, read in the same query where it costs one lookup by primary key.
const RECORD_NAME_SQL = `case entity_type
	when 'CONTACT' then (select full_name from contacts where id = events.entity_id)
	when 'PRODUCT' then (select name from products where id = events.entity_id)
	when 'USER' then (select username from users where id = events.entity_id)
	when 'EMPLOYEE' then (select contacts.full_name from employees
		join contacts on contacts.id = employees.contact_id where employees.id = events.entity_id)
	end`;

// Only the types with a page of their own, each with what its label puts before the id; null
// labels it by the name read with it. A cash movement opens over the book, not on a page of its own.
const RECORD_PAGES = {
	ORDER: ['/(app)/pedidos/[id]', '#'],
	QUOTE: ['/(app)/cotizaciones/[id]', 'Cotización #'],
	RECEIVABLE: ['/(app)/cuentas-de-cobro/[id]', 'CC Nº '],
	CONTACT: ['/(app)/contactos/[id]', null],
	PRODUCT: ['/(app)/productos/[id]', null],
	USER: ['/(app)/logins/[id]', null],
	EMPLOYEE: ['/(app)/personal/[id]', null],
	INVENTORY_COUNT: ['/(app)/inventario/revisar/[id]', '']
} as const;

function hasRecordPage(type: string): type is keyof typeof RECORD_PAGES {
	return type in RECORD_PAGES;
}

// A record whose row is gone, or whose name can't be read, still links under its plain id.
function linkOf(row: EventRow): RecordLink | null {
	if (!hasRecordPage(row.entity_type) || null === row.entity_id) {
		return null;
	}
	const [routeId, prefix] = RECORD_PAGES[row.entity_type];
	const id = String(row.entity_id);
	const label = null === prefix ? (row.record_name ?? id) : `${prefix}${id}`;
	return { href: resolve(routeId, { id }), label };
}

function parseFields(json: string | null): Record<string, FieldValue> {
	return null === json ? {} : eventFieldsSchema.parse(JSON.parse(json));
}

/** Each field either side names, in the order it was written; a side without it held null. */
function diffEvent(beforeJson: string | null, afterJson: string | null): FieldChange[] {
	const before = parseFields(beforeJson);
	const after = parseFields(afterJson);
	const columns = [...new Set([...Object.keys(after), ...Object.keys(before)])];
	return columns.map((column) => ({
		column,
		before: before[column] ?? null,
		after: after[column] ?? null
	}));
}

type EventRow = {
	id: number;
	created_at: number;
	actor_username: string;
	entity_type: string;
	entity_id: number | null;
	entity_key: string | null;
	action: string;
	before: string | null;
	after: string | null;
	reason: string | null;
	ip: string | null;
	user_agent: string | null;
	record_name: string | null;
};

function toAuditEvent(row: EventRow): AuditEvent {
	return {
		id: row.id,
		createdAt: row.created_at,
		username: row.actor_username,
		entityType: row.entity_type,
		entityId: row.entity_id,
		entityKey: row.entity_key,
		action: row.action,
		changes: diffEvent(row.before, row.after),
		reason: row.reason,
		ip: row.ip,
		userAgent: row.user_agent,
		link: linkOf(row)
	};
}

async function countEvents(db: D1Database, where: string, params: Clause['params']) {
	const count = await db
		.prepare(`select count(*) as total from events where ${where}`)
		.bind(...params)
		.first<{ total: number }>();
	return count?.total ?? 0;
}

// Off the `actor_username` index alone, whatever the filters.
async function listUsernames(db: D1Database): Promise<string[]> {
	const { results } = await db
		.prepare('select distinct actor_username as username from events order by actor_username')
		.all<{ username: string }>();
	return results.map(({ username }) => username);
}

/** Auditoría: one page of the Event log, newest first, narrowed by every filter at once. */
export async function getAuditLog(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<AuditLog> {
	requireRole(actor, POLICIES.reports);
	const parsed = auditLogSchema.parse(input ?? {});
	const clauses = auditLogClauses(parsed);
	const where = clauses.map((clause) => `(${clause.sql})`).join(' and ') || '1';
	const params = clauses.flatMap((clause) => clause.params);
	const [total, usernames] = await Promise.all([countEvents(db, where, params), listUsernames(db)]);
	const { page, pageCount, offset } = paginate(total, parsed.page, AUDIT_LOG_PAGE_SIZE);
	const filters = { ...parsed, page };
	const { results } = await db
		.prepare(
			`select id, created_at, actor_username, entity_type, entity_id, entity_key, action, before,
			after, reason, ip, user_agent, ${RECORD_NAME_SQL} as record_name
			from events where ${where} order by created_at desc, id desc limit ? offset ?`
		)
		.bind(...params, AUDIT_LOG_PAGE_SIZE, offset)
		.all<EventRow>();
	return {
		events: results.map(toAuditEvent),
		total,
		pageCount,
		filters,
		usernames
	};
}

// Missing or unreadable, an end is today.
const subLendingSchema = z.object({
	from: optional(z.iso.date()),
	to: optional(z.iso.date())
});

/** An order holding the product on its worst day, and how many it holds. */
export type SubLendingOrder = {
	id: number;
	clientName: string;
	deliveryDate: string;
	pickupDate: string;
	quantity: number;
};

/** A product the orders need more of than the company owns: `missing` = `held` − `owned`, on `worstDay`. */
export type SubLendingProduct = {
	productId: number;
	name: string;
	owned: number;
	held: number;
	missing: number;
	/** The earliest day with the peak. */
	worstDay: string;
	orders: SubLendingOrder[];
};

export type SubLending = { from: string; to: string; products: SubLendingProduct[] };

type HeldRow = {
	day: string;
	productId: number;
	name: string;
	owned: number;
	orderId: number;
	clientName: string;
	deliveryDate: string;
	pickupDate: string;
	quantity: number;
};

// One row per product, day and order holding it: the reserving rule is availability's own.
const SUB_LENDING_SQL = `${HELD_LINES_SQL}
	select held.day, held.product_id as productId, products.name, products.total_quantity as owned,
		held.order_id as orderId, json_extract(orders.client_attributes, '$.name') as clientName,
		orders.delivery_date as deliveryDate, orders.pickup_date as pickupDate, sum(held.qty) as quantity
	from held
	join products on products.id = held.product_id
	join orders on orders.id = held.order_id
	group by held.product_id, held.day, held.order_id
	order by held.day`;

type Day = { day: string; held: number; rows: HeldRow[] };

// Rows come ordered by day, so a later day only wins with more held: the earliest peak stays.
function findWorstDay(rows: HeldRow[]): Day {
	const days = new Map<string, Day>();
	for (const row of rows) {
		const day = days.get(row.day) ?? { day: row.day, held: 0, rows: [] };
		day.held += row.quantity;
		day.rows.push(row);
		days.set(row.day, day);
	}
	return [...days.values()].reduce((worst, day) => (day.held > worst.held ? day : worst));
}

function toShortProduct(rows: HeldRow[]): SubLendingProduct | null {
	const worst = findWorstDay(rows);
	const { productId, name, owned } = worst.rows[0];
	if (worst.held <= owned) {
		return null;
	}
	const orders = worst.rows
		.map((row) => ({
			id: row.orderId,
			clientName: row.clientName,
			deliveryDate: row.deliveryDate,
			pickupDate: row.pickupDate,
			quantity: row.quantity
		}))
		.sort((first, second) => second.quantity - first.quantity || first.id - second.id);
	return {
		productId,
		name,
		owned,
		held: worst.held,
		missing: worst.held - owned,
		worstDay: worst.day,
		orders
	};
}

/**
 * Subalquiler: each product the reserving orders need more of than the company owns, on the
 * period's worst day for it, never a sum over days. Most missing first, then by name.
 */
export async function getSubLending(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SubLending> {
	requireRole(actor, POLICIES.orders);
	const parsed = subLendingSchema.parse(input ?? {});
	const today = getTodaysDate();
	// Hasta typed before Desde still means the days between them.
	const [from, to] = [parsed.from ?? today, parsed.to ?? today].sort();
	const { results } = await db.prepare(SUB_LENDING_SQL).bind(from, to, null).all<HeldRow>();
	const byProduct = Map.groupBy(results, (row) => row.productId);
	const products = [...byProduct.values()]
		.map(toShortProduct)
		.filter((product) => null !== product)
		.sort(
			(first, second) =>
				second.missing - first.missing || first.name.localeCompare(second.name, 'es')
		);
	return { from, to, products };
}

// Missing or unreadable, the period is the current Bogotá month.
const profitAndLossSchema = z.object({
	from: optional(z.iso.date()),
	to: optional(z.iso.date())
});

// Each line of the P&L and the concepts it sums: the page links each line to Movimientos caja
// filtered by these, so the report and the book can't disagree on what a line holds.
const PROFIT_AND_LOSS_CONCEPTS = {
	collected: ['INSTALLMENT', 'INSTALLMENT_REFUND', 'CANCELLATION_FEE'],
	otherIncome: ['OTHER_INCOME'],
	damageCharges: ['DAMAGE_CHARGE'],
	transport: ['TRANSPORT_EXPENSE', 'CARRIER_PAYMENT'],
	supplies: ['SUPPLIES_EXPENSE'],
	salaries: ['PAYROLL'],
	rent: ['RENT'],
	other: ['OTHER_EXPENSE']
} as const satisfies Record<string, readonly CashConcept[]>;

/** A line's net by movement date, offsets included, and the concepts it sums. */
export type ProfitAndLossLine = { amount: number; concepts: CashConcept[] };

export type ProfitAndLoss = {
	from: string;
	to: string;
	income: {
		/** Recaudado: deposits never in it. */
		collected: ProfitAndLossLine;
		otherIncome: ProfitAndLossLine;
		/** Cobrado por novedades, and how many orders it came from. */
		damageCharges: ProfitAndLossLine & { orderCount: number };
		total: number;
	};
	/** Every amount negative, or zero. */
	expenses: {
		transport: ProfitAndLossLine & { transportExpenses: number; carrierPayments: number };
		supplies: ProfitAndLossLine;
		/** Nómina, and how many payroll weeks it pays. */
		salaries: ProfitAndLossLine & { weekCount: number };
		rent: ProfitAndLossLine;
		other: ProfitAndLossLine;
		total: number;
	};
	/** Income plus expenses: only money that came in or went out, so it matches Caja. */
	result: number;
	/** Vendido: orders with their event in the period, cancelled ones left out, paid or not. */
	sold: { count: number; rental: number; transport: number; total: number };
	/**
	 * Pérdidas: what incidents reported in the period cost, at today's Costo de reposición, whoever
	 * is responsible. Never in the result: replacing a product is a Gasto when it's paid.
	 */
	losses: {
		/** Most costly first; a product with no cost («sin costo») has `cost: null` and adds nothing. */
		products: {
			productId: number;
			name: string;
			units: number;
			cost: number | null;
			total: number;
		}[];
		total: number;
		/** How many of the products have no replacement cost. */
		withoutCost: number;
	};
	/** Sin cobrar: per order, its client-responsible losses less its damage charges of all time. */
	uncollected: {
		orders: {
			orderId: number;
			clientName: string;
			loss: number;
			charged: number;
			/** Never below zero: charging more than the loss leaves nothing to collect. */
			uncollected: number;
		}[];
		total: number;
		/** How many orders still have something to collect. */
		orderCount: number;
	};
};

// Deposits and their refunds are never read: a retention paired with a fee or a damage charge
// already nets inside that concept's own movements.
const READ_CONCEPTS = Object.values(PROFIT_AND_LOSS_CONCEPTS).flat();

async function sumByConcept(db: D1Database, from: string, to: string) {
	const { results } = await db
		.prepare(
			`select concept, sum(amount) as amount from cash_movements
			where movement_date between ? and ? and concept in (${READ_CONCEPTS.map(() => '?').join(', ')})
			group by concept`
		)
		.bind(from, to, ...READ_CONCEPTS)
		.all<{ concept: CashConcept; amount: number }>();
	const sums = new Map(results.map(({ concept, amount }) => [concept, amount]));
	return (concept: CashConcept) => sums.get(concept) ?? 0;
}

// The links whose movements of `concept` in the period don't cancel out: a charge or a payroll
// run offset in full paid nothing.
const NET_LINKS_SQL = `select entity_id from cash_movements
	where concept = ? and movement_date between ? and ?
	group by entity_id having sum(amount) <> 0`;

async function countDamagedOrders(db: D1Database, from: string, to: string): Promise<number> {
	const row = await db
		.prepare(`select count(*) as total from (${NET_LINKS_SQL})`)
		.bind('DAMAGE_CHARGE', from, to)
		.first<{ total: number }>();
	return row?.total ?? 0;
}

// A week's runs are one per employee: the sub-line counts weeks, not people.
async function countPayrollWeeks(db: D1Database, from: string, to: string): Promise<number> {
	const row = await db
		.prepare(
			`select count(distinct payroll_runs.period_start) as total from (${NET_LINKS_SQL}) paid
			join payroll_runs on payroll_runs.id = paid.entity_id`
		)
		.bind('PAYROLL', from, to)
		.first<{ total: number }>();
	return row?.total ?? 0;
}

async function sumSold(db: D1Database, from: string, to: string): Promise<ProfitAndLoss['sold']> {
	const row = await db
		.prepare(
			`select count(*) as count, coalesce(sum(items_total - discount), 0) as rental,
				coalesce(sum(transport_cost), 0) as transport, coalesce(sum(order_total), 0) as total
			from orders where event_date between ? and ? and status <> 'CANCELLED'`
		)
		.bind(from, to)
		.first<ProfitAndLoss['sold']>();
	return row ?? { count: 0, rental: 0, transport: 0, total: 0 };
}

// Each unit gone (lost or unrecoverable) in an active incident reported in the period, bound to
// ?1 and ?2, the period's first instant and the next day's. Recoverable units never count.
const LOST_UNITS_SQL = `select incidents.order_id, incidents.responsible_party,
		json_extract(item.value, '$.product_id') as product_id, json_extract(item.value, '$.qty') as qty
	from incidents, json_each(incidents.incident_items) as item
	where incidents.status = 'ACTIVE' and incidents.created_at >= ?1 and incidents.created_at < ?2
	and json_extract(item.value, '$.outcome') in ('LOST', 'UNRECOVERABLE')`;

const REPLACEMENT_COST_SQL = `json_extract(products.attributes, '$.replacement_cost')`;

function periodInstants(from: string, to: string): [number, number] {
	return [getDayStartInstant(from), getDayStartInstant(addDays(to, 1))];
}

async function sumLosses(
	db: D1Database,
	from: string,
	to: string
): Promise<ProfitAndLoss['losses']> {
	const { results } = await db
		.prepare(
			`select products.id as productId, products.name, sum(lost.qty) as units,
				${REPLACEMENT_COST_SQL} as cost, coalesce(sum(lost.qty) * ${REPLACEMENT_COST_SQL}, 0) as total
			from (${LOST_UNITS_SQL}) lost join products on products.id = lost.product_id
			group by products.id order by total desc, products.name`
		)
		.bind(...periodInstants(from, to))
		.all<ProfitAndLoss['losses']['products'][number]>();
	return {
		products: results,
		total: results.reduce((sum, product) => sum + product.total, 0),
		withoutCost: results.filter((product) => null === product.cost).length
	};
}

async function sumUncollected(
	db: D1Database,
	from: string,
	to: string
): Promise<ProfitAndLoss['uncollected']> {
	const { results } = await db
		.prepare(
			`select orders.id as orderId, json_extract(orders.client_attributes, '$.name') as clientName,
				sum(lost.qty * coalesce(${REPLACEMENT_COST_SQL}, 0)) as loss, ${DAMAGE_CHARGED_SQL} as charged
			from (${LOST_UNITS_SQL}) lost join products on products.id = lost.product_id
			join orders on orders.id = lost.order_id
			where lost.responsible_party = 'CLIENT'
			group by orders.id order by orders.id`
		)
		.bind(...periodInstants(from, to))
		.all<{ orderId: number; clientName: string; loss: number; charged: number }>();
	const orders = results.map((order) => ({
		...order,
		uncollected: Math.max(0, order.loss - order.charged)
	}));
	return {
		orders,
		total: orders.reduce((sum, order) => sum + order.uncollected, 0),
		orderCount: orders.filter((order) => order.uncollected > 0).length
	};
}

type SumOf = (concept: CashConcept) => number;

function totalOf(lines: Record<string, ProfitAndLossLine>): number {
	return Object.values(lines).reduce((sum, line) => sum + line.amount, 0);
}

function lineOf(sumOf: SumOf, line: keyof typeof PROFIT_AND_LOSS_CONCEPTS): ProfitAndLossLine {
	const concepts = [...PROFIT_AND_LOSS_CONCEPTS[line]];
	return { amount: concepts.reduce((sum, concept) => sum + sumOf(concept), 0), concepts };
}

function incomeOf(sumOf: SumOf, damagedOrders: number): ProfitAndLoss['income'] {
	const lines = {
		collected: lineOf(sumOf, 'collected'),
		otherIncome: lineOf(sumOf, 'otherIncome'),
		damageCharges: { ...lineOf(sumOf, 'damageCharges'), orderCount: damagedOrders }
	};
	return { ...lines, total: totalOf(lines) };
}

function expensesOf(sumOf: SumOf, payrollWeeks: number): ProfitAndLoss['expenses'] {
	const lines = {
		transport: {
			...lineOf(sumOf, 'transport'),
			transportExpenses: sumOf('TRANSPORT_EXPENSE'),
			carrierPayments: sumOf('CARRIER_PAYMENT')
		},
		supplies: lineOf(sumOf, 'supplies'),
		salaries: { ...lineOf(sumOf, 'salaries'), weekCount: payrollWeeks },
		rent: lineOf(sumOf, 'rent'),
		other: lineOf(sumOf, 'other')
	};
	return { ...lines, total: totalOf(lines) };
}

/**
 * Pérdidas y ganancias: what came in and went out in the period, on cash and by movement date so
 * it matches Movimientos caja, and apart from the result, what was sold for events in it and what
 * incidents cost.
 */
export async function getProfitAndLoss(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<ProfitAndLoss> {
	requireRole(actor, POLICIES.reports);
	const parsed = profitAndLossSchema.parse(input ?? {});
	const month = getMonthRange(getTodaysDate());
	const from = parsed.from ?? month.start;
	const to = parsed.to ?? month.end;
	const [sumOf, damagedOrders, payrollWeeks, sold, losses, uncollected] = await Promise.all([
		sumByConcept(db, from, to),
		countDamagedOrders(db, from, to),
		countPayrollWeeks(db, from, to),
		sumSold(db, from, to),
		sumLosses(db, from, to),
		sumUncollected(db, from, to)
	]);
	const income = incomeOf(sumOf, damagedOrders);
	const expenses = expensesOf(sumOf, payrollWeeks);
	const result = income.total + expenses.total;
	return { from, to, income, expenses, result, sold, losses, uncollected };
}
