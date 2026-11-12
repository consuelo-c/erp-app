// Cotizaciones: an order without its trips or its money. What it shares with the order is code,
// not rows: its lines are validated with `orderItemsSchema` and its client's snapshot with
// `clientAttributesSchema`, and the «Cliente» and the lines are resolved by the order's own
// helpers, all imported from the order service, never redefined here. Nothing here reaches
// `orders`' readers or `cash_movements`, and no quote is ever deleted.

import { z } from 'zod';
import { addDays, getInstantDate, getTodaysDate } from '$lib/datetime';
import { calculateOrderTotals, type OrderTotals, type PricedLine } from '$lib/orders';
import { getQuoteState, QUOTE_STATE_SQL, QUOTE_STATES, type QuoteState } from '$lib/quotes';
import { requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate, eventFieldsSchema } from '../audit';
import { describeQuoteEdit, type OrderChange } from '../order-changes';
import {
	blankable,
	clientAttributesSchema,
	clientInputShape,
	clientWrite,
	getOrder,
	invalidOrder,
	jsonColumn,
	linesInputSchema,
	listCatalogProducts,
	orderItemsSchema,
	pesosInputSchema,
	prepareQuotedOrder,
	refusal,
	resolveClient,
	resolveItems,
	searchTextSchema,
	type CatalogProduct,
	type ClientAttributes,
	type OrderItem,
	type Refusal,
	type SaveResult,
	type ShortageWarning
} from './orders';
import { foldedSql, optional } from './cash';
import {
	getContact,
	isAutoDocument,
	searchClause,
	type ClientCandidate,
	type NewClient
} from './contacts';
import { COMPANY_SETTINGS, readSettings, type CompanySettings } from './settings';

// The same three who take orders: converting a quote creates one.
const TAKES_QUOTES = ['ADMIN', 'MANAGER', 'SALES'] as const;

const textSchema = z.string().min(1);

// The second line of «Lugar del evento» completes the first, as on an order's trip.
function hasFirstAddressLine(attributes: { address_1?: string; address_2?: string }): boolean {
	return undefined === attributes.address_2 || undefined !== attributes.address_1;
}

// SQLite validates nothing: checked on write and on read. A new key is a code change.
export const quoteAttributesSchema = z
	.strictObject({
		address_1: textSchema.optional(),
		address_2: textSchema.optional(),
		notes: textSchema.optional()
	})
	.refine(hasFirstAddressLine, 'The second address line needs the first');

export type QuoteAttributes = z.infer<typeof quoteAttributesSchema>;

type PricedQuote = {
	quote_items: PricedLine[];
	rental_days: number;
	discount: number;
	transport_cost: number | null;
};

const transportInputSchema = z
	.number('Escribe el transporte en pesos')
	.int('Escribe el transporte en pesos')
	.min(0, 'No puede ser negativo');

// Any total sent along is ignored: the service works them out. An empty transport is «por
// acordar», stored NULL; 0 is a real price, for a client who picks up.
const quoteInputSchema = z
	.object({
		...clientInputShape,
		event_date: blankable.pipe(z.iso.date('Escoge la fecha del evento').nullable()),
		valid_until: z.iso.date('Escoge hasta cuándo es válida'),
		rental_days: z.number('Escribe los días cobrados').int().min(1, 'Se cobra al menos un día'),
		quote_items: linesInputSchema,
		discount: pesosInputSchema('Escribe el descuento en pesos'),
		transport_cost: transportInputSchema.nullable().default(null),
		address_1: blankable,
		address_2: blankable,
		notes: blankable
	})
	.refine((quote) => null === quote.address_2 || null !== quote.address_1, {
		message: 'Escribe la primera línea de la dirección',
		path: ['address_1']
	})
	// The discount comes off the items only, never off transport.
	.refine((quote) => quote.discount <= totalsOf(quote).itemsTotal, {
		message: 'El descuento no puede ser mayor que el subtotal',
		path: ['discount']
	});

type QuoteInput = z.output<typeof quoteInputSchema>;

// «Por acordar» goes into the order's function as 0: the total reads «Total sin transporte».
function totalsOf(quote: PricedQuote): OrderTotals {
	return calculateOrderTotals({
		lines: quote.quote_items,
		rentalDays: quote.rental_days,
		discount: quote.discount,
		transportCost: quote.transport_cost ?? 0
	});
}

export type Quote = {
	id: number;
	state: QuoteState;
	clientId: number;
	orderId: number | null;
	client: ClientAttributes;
	eventDate: string | null;
	validUntil: string;
	rentalDays: number;
	items: OrderItem[];
	itemsTotal: number;
	discount: number;
	/** Null is «por acordar». */
	transportCost: number | null;
	quoteTotal: number;
	address1: string | null;
	address2: string | null;
	notes: string | null;
	createdAt: number;
};

type Columns = {
	client_id: number | null; // null until «Cliente nuevo»'s contact exists, in the same batch
	event_date: string | null;
	valid_until: string;
	rental_days: number;
	client_attributes: string;
	quote_items: string;
	items_total: number;
	discount: number;
	transport_cost: number | null;
	quote_total: number;
	attributes: string;
};

export type QuoteRow = Omit<Columns, 'client_id'> & {
	id: number;
	client_id: number;
	order_id: number | null;
	created_at: number;
};

export const SELECT_QUOTE = `select id, client_id, order_id, event_date, valid_until, rental_days,
	client_attributes, quote_items, items_total, discount, transport_cost, quote_total, attributes,
	created_at from quotes`;

export function toQuote(row: QuoteRow): Quote {
	const attributes = quoteAttributesSchema.parse(JSON.parse(row.attributes));
	const validity = { orderId: row.order_id, validUntil: row.valid_until };
	return {
		id: row.id,
		state: getQuoteState(validity, getTodaysDate()),
		clientId: row.client_id,
		orderId: row.order_id,
		client: clientAttributesSchema.parse(JSON.parse(row.client_attributes)),
		eventDate: row.event_date,
		validUntil: row.valid_until,
		rentalDays: row.rental_days,
		items: orderItemsSchema.parse(JSON.parse(row.quote_items)),
		itemsTotal: row.items_total,
		discount: row.discount,
		transportCost: row.transport_cost,
		quoteTotal: row.quote_total,
		address1: attributes.address_1 ?? null,
		address2: attributes.address_2 ?? null,
		notes: attributes.notes ?? null,
		createdAt: row.created_at
	};
}

const quoteIdSchema = z.coerce.number().int().positive();

async function findRow(db: D1Database, id: number): Promise<QuoteRow | null> {
	return db.prepare(`${SELECT_QUOTE} where id = ?`).bind(id).first<QuoteRow>();
}

/** The quote, with its state as of today in Bogotá, or null when there's no such quote. */
export async function getQuote(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<Quote | null> {
	requireRole(actor, TAKES_QUOTES);
	const parsedId = quoteIdSchema.safeParse(id);
	if (!parsedId.success) {
		return null;
	}
	const row = await findRow(db, parsedId.data);
	return null === row ? null : toQuote(row);
}

/** What the quote form picks from, read once when it opens. */
export type QuoteFormOptions = {
	products: CatalogProduct[];
	/** A new quote's «Válida hasta», today plus `QUOTES_VALIDITY_DAYS`, and those days for its note. */
	validUntil: string;
	validityDays: number;
};

export async function getQuoteFormOptions(
	db: D1Database,
	actor: Actor | null
): Promise<QuoteFormOptions> {
	requireRole(actor, TAKES_QUOTES);
	const [products, settings] = await Promise.all([
		listCatalogProducts(db, actor),
		readSettings(db, ['QUOTES_VALIDITY_DAYS'])
	]);
	const validityDays = settings.QUOTES_VALIDITY_DAYS;
	return { products, validUntil: addDays(getTodaysDate(), validityDays), validityDays };
}

// A quote can't expire before the day it was made: today for a new one.
function expiresTooSoon(quote: QuoteInput, createdOn: string): Refusal | null {
	if (quote.valid_until >= createdOn) {
		return null;
	}
	return refusal('valid_until', 'No puede ser antes del día en que se hizo la cotización');
}

// Through the schemas, so the JSON always has the same keys in the same order: an edit that
// changes nothing produces the same text and logs nothing.
function toColumns(quote: QuoteInput, resolved: { client: ClientAttributes; items: OrderItem[] }) {
	const { itemsTotal, orderTotal } = totalsOf(quote);
	const attributes = {
		address_1: quote.address_1 ?? undefined,
		address_2: quote.address_2 ?? undefined,
		notes: quote.notes ?? undefined
	};
	return {
		client_id: quote.client_id,
		event_date: quote.event_date,
		valid_until: quote.valid_until,
		rental_days: quote.rental_days,
		client_attributes: JSON.stringify(clientAttributesSchema.parse(resolved.client)),
		quote_items: JSON.stringify(orderItemsSchema.parse(resolved.items)),
		items_total: itemsTotal,
		discount: quote.discount,
		transport_cost: quote.transport_cost,
		quote_total: orderTotal,
		attributes: JSON.stringify(quoteAttributesSchema.parse(attributes))
	} satisfies Columns;
}

type ResolvedQuote = { columns: Columns; newClient: NewClient | null };

/** The columns to store for `quote`, or why it can't be saved. `current` is the quote being edited. */
async function resolveColumns(
	db: D1Database,
	quote: QuoteInput,
	current: Quote | null
): Promise<ResolvedQuote | Refusal> {
	const client = await resolveClient(db, quote, current);
	if ('ok' in client) {
		return client;
	}
	const lines = { field: 'quote_items', lines: quote.quote_items, rentalDays: quote.rental_days };
	const items = await resolveItems(db, lines, current?.items ?? []);
	if ('ok' in items) {
		return items;
	}
	const columns = toColumns(quote, { client: client.snapshot, items });
	return { columns, newClient: client.newClient };
}

async function insertQuote(
	db: D1Database,
	actor: Actor,
	resolved: ResolvedQuote
): Promise<SaveResult> {
	const { values, computed, clientStatements } = clientWrite(db, actor, resolved);
	// The client's page key, set once and never changed: like the order's, it stays out of events.
	const statements = auditedInsert(db, {
		table: 'quotes',
		entityType: 'QUOTE',
		actor,
		values,
		unlogged: { public_token: crypto.randomUUID() },
		computed
	});
	const results = await db.batch([...clientStatements, ...statements]);
	return { ok: true, id: results[clientStatements.length].meta.last_row_id };
}

/** A new quote, on a client picked or a new one, valid from today. */
export async function createQuote(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, TAKES_QUOTES);
	const parsed = quoteInputSchema.safeParse(input);
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	const tooSoon = expiresTooSoon(parsed.data, getTodaysDate());
	if (null !== tooSoon) {
		return tooSoon;
	}
	const resolved = await resolveColumns(db, parsed.data, null);
	return 'ok' in resolved ? resolved : insertQuote(db, actor, resolved);
}

const NOT_FOUND: Refusal = { ok: false, message: 'Esa cotización no existe', errors: {} };

const NOT_EDITABLE: Refusal = {
	ok: false,
	message: 'Esta cotización ya se convirtió en pedido: no se puede editar',
	errors: {}
};

// `quote_items` and each JSON column are logged whole when anything in them changed.
async function applyEdit(
	db: D1Database,
	actor: Actor,
	{ row, resolved }: { row: QuoteRow; resolved: ResolvedQuote }
): Promise<SaveResult> {
	const { values, computed, clientStatements } = clientWrite(db, actor, resolved);
	const statements = auditedUpdate(db, {
		table: 'quotes',
		entityType: 'QUOTE',
		actor,
		id: row.id,
		current: row,
		changes: values,
		computed
	});
	if (0 < statements.length) {
		await db.batch([...clientStatements, ...statements]);
	}
	return { ok: true, id: row.id };
}

const editInputSchema = z.object({ id: quoteIdSchema });

/**
 * The whole form, valid or expired: editing is how an expired quote is renewed. A converted one is
 * read-only. Lines already on it keep their frozen name and price.
 */
export async function updateQuote(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, TAKES_QUOTES);
	const parsedId = editInputSchema.safeParse(input);
	const parsed = quoteInputSchema.safeParse(input);
	if (!parsedId.success) {
		return invalidOrder(parsedId.error);
	}
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	const row = await findRow(db, parsedId.data.id);
	if (null === row) {
		return NOT_FOUND;
	}
	if (null !== row.order_id) {
		return NOT_EDITABLE;
	}
	const tooSoon = expiresTooSoon(parsed.data, getInstantDate(row.created_at));
	if (null !== tooSoon) {
		return tooSoon;
	}
	const resolved = await resolveColumns(db, parsed.data, toQuote(row));
	return 'ok' in resolved ? resolved : applyEdit(db, actor, { row, resolved });
}

/** A page of the quote list: it never loads the whole table. */
export const QUOTES_PAGE_SIZE = 20;

/** The list's state filter: a state, or all of them. */
export const QUOTE_STATE_FILTERS = [...QUOTE_STATES, 'ALL'] as const;

export type QuoteStateFilter = (typeof QUOTE_STATE_FILTERS)[number];

// The open ones still valid by default; a tampered value is the default too. `page` past the last
// one shows the last.
const listSchema = z.object({
	text: optional(searchTextSchema),
	state: z.enum(QUOTE_STATE_FILTERS).catch('VALID'),
	page: z.coerce.number().int().min(1).catch(1)
});

export type QuoteFilters = z.output<typeof listSchema>;

export type QuoteSummary = {
	id: number;
	clientName: string;
	eventDate: string | null;
	validUntil: string;
	state: QuoteState;
	quoteTotal: number;
	/** Transport «por acordar»: the total leaves it out. */
	isTransportPending: boolean;
};

/** The filters come back parsed, `page` clamped. `hasQuotes` tells an empty table from no match. */
export type QuotePage = {
	quotes: QuoteSummary[];
	total: number;
	pageCount: number;
	filters: QuoteFilters;
	hasQuotes: boolean;
};

type Clause = { sql: string; params: (string | number)[] };

// The order list's rules, over the quote's own snapshot: never the contact's current name or phone.
function listClauses(filters: QuoteFilters, today: string): Clause[] {
	const columns = {
		textSql: foldedSql("json_extract(client_attributes, '$.name')"),
		phoneSql: "json_extract(client_attributes, '$.phone')",
		whatsappSql: "json_extract(client_attributes, '$.whatsapp')"
	};
	const search = undefined === filters.text ? null : searchClause(filters.text, columns);
	const state =
		'ALL' === filters.state
			? null
			: { sql: `(${QUOTE_STATE_SQL}) = ?`, params: [today, filters.state] };
	return [search, state].filter((clause) => null !== clause);
}

type SummaryRow = {
	id: number;
	client_name: string;
	event_date: string | null;
	valid_until: string;
	order_id: number | null;
	quote_total: number;
	transport_cost: number | null;
};

function toSummary(row: SummaryRow, today: string): QuoteSummary {
	return {
		id: row.id,
		clientName: row.client_name,
		eventDate: row.event_date,
		validUntil: row.valid_until,
		state: getQuoteState({ orderId: row.order_id, validUntil: row.valid_until }, today),
		quoteTotal: row.quote_total,
		isTransportPending: null === row.transport_cost
	};
}

async function countQuotes(
	db: D1Database,
	{ where, params }: { where: string; params: Clause['params'] }
) {
	const count = await db
		.prepare(
			`select count(*) as total, (select count(*) from quotes) as everyone from quotes where ${where}`
		)
		.bind(...params)
		.first<{ total: number; everyone: number }>();
	return { total: count?.total ?? 0, hasQuotes: 0 < (count?.everyone ?? 0) };
}

/** One page of quotes, newest first, narrowed by every filter at once, in SQL. */
export async function listQuotes(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<QuotePage> {
	requireRole(actor, TAKES_QUOTES);
	const today = getTodaysDate();
	const parsed = listSchema.parse(input ?? {});
	const clauses = listClauses(parsed, today);
	const where = clauses.map((clause) => `(${clause.sql})`).join(' and ') || '1';
	const params = clauses.flatMap((clause) => clause.params);
	const { total, hasQuotes } = await countQuotes(db, { where, params });
	const pageCount = Math.max(1, Math.ceil(total / QUOTES_PAGE_SIZE));
	const filters = { ...parsed, page: Math.min(parsed.page, pageCount) };
	const { results } = await db
		.prepare(
			`select id, json_extract(client_attributes, '$.name') as client_name, event_date,
			valid_until, order_id, quote_total, transport_cost
			from quotes where ${where} order by id desc limit ? offset ?`
		)
		.bind(...params, QUOTES_PAGE_SIZE, (filters.page - 1) * QUOTES_PAGE_SIZE)
		.all<SummaryRow>();
	const quotes = results.map((row) => toSummary(row, today));
	return { quotes, total, pageCount, filters, hasQuotes };
}

/** The quote as its detail reads it: which of its lines hold a product deactivated since. */
export type QuoteDetail = Quote & { inactiveProductIds: number[] };

export async function getQuoteDetail(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<QuoteDetail | null> {
	const quote = await getQuote(db, id, actor);
	if (null === quote) {
		return null;
	}
	const { results } = await db
		.prepare('select id from products where active = 0 and id in (select value from json_each(?))')
		.bind(JSON.stringify(quote.items.map((item) => item.product_id)))
		.all<{ id: number }>();
	return { ...quote, inactiveProductIds: results.map((row) => row.id) };
}

/** One row of a quote's timeline. The edit's fields stay in `events` until it's expanded. */
export type QuoteTimelineEntry = {
	id: number;
	action: 'CREATED' | 'EDITED' | 'CONVERTED';
	/** The order a `CONVERTED` created. */
	orderId: number | null;
	actorUsername: string;
	createdAt: number;
};

/** The quote's events, newest first, every one for every role that reaches it. Null: no such quote. */
export async function getQuoteTimeline(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<QuoteTimelineEntry[] | null> {
	requireRole(actor, TAKES_QUOTES);
	const parsedId = quoteIdSchema.safeParse(id);
	if (!parsedId.success || null === (await findRow(db, parsedId.data))) {
		return null;
	}
	const { results } = await db
		.prepare(
			`select id, action, json_extract(after, '$.order_id') as orderId,
			actor_username as actorUsername, created_at as createdAt from events
			where entity_type = 'QUOTE' and entity_id = ? order by created_at desc, id desc`
		)
		.bind(parsedId.data)
		.all<QuoteTimelineEntry>();
	return results;
}

// What an edit logs, read back through each column's schema. The client shows as its name, and the
// totals the lines and the discount work out aren't changes of their own: z.object drops them.
const editedFieldsSchema = z.object({
	event_date: z.iso.date().nullable().optional(),
	valid_until: z.iso.date().optional(),
	rental_days: z.number().int().optional(),
	discount: z.number().int().optional(),
	transport_cost: z.number().int().nullable().optional(),
	client_attributes: jsonColumn(clientAttributesSchema),
	quote_items: jsonColumn(orderItemsSchema),
	attributes: jsonColumn(quoteAttributesSchema)
});

export type QuoteEditedFields = z.infer<typeof editedFieldsSchema>;

function toEditedFields(json: string | null): QuoteEditedFields {
	return editedFieldsSchema.parse(eventFieldsSchema.parse(JSON.parse(json ?? '{}')));
}

const changeInputSchema = z.object({ quote: quoteIdSchema, event: quoteIdSchema });

/** One edit's diff, fetched when its timeline row opens. Null for an event that isn't an edit of that quote. */
export async function getQuoteChange(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<OrderChange[] | null> {
	requireRole(actor, TAKES_QUOTES);
	const parsed = changeInputSchema.safeParse(input);
	if (!parsed.success) {
		return null;
	}
	const row = await db
		.prepare(
			`select before, after from events
			where id = ? and entity_type = 'QUOTE' and entity_id = ? and action = 'EDITED'`
		)
		.bind(parsed.data.event, parsed.data.quote)
		.first<{ before: string | null; after: string | null }>();
	return null === row
		? null
		: describeQuoteEdit(toEditedFields(row.before), toEditedFields(row.after));
}

/** A quote's terms, as the form fills a new one from them. */
export type QuoteDraft = Pick<
	Quote,
	| 'clientId'
	| 'client'
	| 'address1'
	| 'address2'
	| 'rentalDays'
	| 'items'
	| 'discount'
	| 'transportCost'
	| 'notes'
>;

/**
 * «Duplicar» from a quote, or «Cotizar de nuevo» from an order: the new quote's draft, where it came
 * from, and the inactive products it left out. The new quote keeps no link to its source.
 */
export type QuoteDuplicate = {
	source: { kind: 'QUOTE' | 'ORDER'; id: number };
	draft: QuoteDraft;
	removed: string[];
};

type CatalogPrice = { id: number; name: string; rental_price: number };

// Today's name and list price of each active product among `productIds`.
async function readActivePrices(
	db: D1Database,
	productIds: number[]
): Promise<Map<number, CatalogPrice>> {
	const { results } = await db
		.prepare(
			`select id, name, rental_price from products
			where active = 1 and id in (select value from json_each(?))`
		)
		.bind(JSON.stringify(productIds))
		.all<CatalogPrice>();
	return new Map(results.map((product) => [product.id, product]));
}

// Each line at today's catalog name and list price, charged at that price; an inactive product's
// line is left out and named.
function repriceLines(quote: QuoteDraft, prices: Map<number, CatalogPrice>) {
	const items = quote.items
		.filter((item) => prices.has(item.product_id))
		.map((item) => {
			const { name, rental_price: price } = prices.get(item.product_id) as CatalogPrice;
			const lineTotal = item.qty * price * quote.rentalDays;
			return { ...item, name, list_price: price, unit_price: price, line_total: lineTotal };
		});
	const removed = quote.items
		.filter((item) => !prices.has(item.product_id))
		.map((item) => item.name);
	return { items, removed };
}

/**
 * The one rule for «Duplicar» and «Cotizar de nuevo»: a fresh quote at today's prices, for a client
 * who repeats its event or books it again. Each line takes the catalog's name and list price, and
 * charges that price; what was negotiated isn't carried. An inactive product is left out and named.
 * The event date and «Válida hasta» are the form's: empty, and today's default. Writes nothing.
 */
async function freshDraft(db: D1Database, terms: QuoteDraft) {
	const productIds = terms.items.map((item) => item.product_id);
	const { items, removed } = repriceLines(terms, await readActivePrices(db, productIds));
	return { draft: { ...terms, items }, removed };
}

/** «Duplicar»: quote `id`'s terms, fresh. Null: no such quote. */
export async function getQuoteDuplicate(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<QuoteDuplicate | null> {
	const quote = await getQuote(db, id, actor);
	if (null === quote) {
		return null;
	}
	const { clientId, client, address1, address2, rentalDays, items, discount, transportCost } =
		quote;
	const terms = {
		clientId,
		client,
		address1,
		address2,
		rentalDays,
		items,
		discount,
		transportCost
	};
	const fresh = await freshDraft(db, { ...terms, notes: quote.notes });
	return { source: { kind: 'QUOTE', id: quote.id }, ...fresh };
}

/**
 * «Cotizar de nuevo»: order `id`'s terms, fresh, in any state: «Lugar del evento» is its delivery
 * address. Null: no such order.
 */
export async function getOrderRequote(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<QuoteDuplicate | null> {
	requireRole(actor, TAKES_QUOTES);
	const orderId = quoteIdSchema.safeParse(id);
	const order = orderId.success ? await getOrder(db, orderId.data, actor) : null;
	if (null === order) {
		return null;
	}
	const { clientId, client, rentalDays, items, discount, transportCost, notes } = order;
	const { address_1: address1, address_2: address2 } = order.delivery;
	const terms = { clientId, client, address1, address2, rentalDays, items, discount, notes };
	const fresh = await freshDraft(db, { ...terms, transportCost });
	return { source: { kind: 'ORDER', id: order.id }, ...fresh };
}

/** «Convertir en pedido»: the quote, and its client as the contact is today, for the order form. */
export type QuoteConversion = { quote: Quote; client: ClientCandidate };

/** What the order form opens filled with. Writes nothing: only «Guardar pedido» converts. Null: no such quote. */
export async function getQuoteConversion(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<QuoteConversion | null> {
	const quote = await getQuote(db, id, actor);
	if (null === quote) {
		return null;
	}
	// The contact is the quote's foreign key: it's always there.
	const contact = await getContact(db, quote.clientId, actor);
	const { fullName, phone, whatsapp, address1, address2 } = contact as ClientCandidate;
	const client = { id: quote.clientId, fullName, phone, whatsapp, address1, address2 };
	return { quote, client };
}

const conversionInputSchema = z.object({
	quote: quoteIdSchema,
	order: z.unknown(),
	force: z.boolean().default(false)
});

const ALREADY_CONVERTED: Refusal = {
	ok: false,
	message: 'Esta cotización ya se convirtió en pedido',
	errors: {}
};

const EXPIRED: Refusal = {
	ok: false,
	message: 'Esta cotización está vencida: edítala con una nueva fecha de vigencia para convertirla',
	errors: {}
};

type Link = { row: QuoteRow; publicToken: string };

// The quote's `order_id`, and its CONVERTED event's, from the order's token: by then
// `last_insert_rowid()` is the order's own event.
function linkStatements(db: D1Database, actor: Actor, { row, publicToken }: Link) {
	const orderId = { sql: 'select id from orders where public_token = ?', params: [publicToken] };
	return auditedUpdate(db, {
		table: 'quotes',
		entityType: 'QUOTE',
		actor,
		id: row.id,
		current: row,
		changes: {},
		computed: { order_id: { ...orderId, isLogged: true } },
		action: 'CONVERTED'
	});
}

/**
 * «Guardar pedido» on the form a quote filled: the only way an order is born, CONFIRMED, with its
 * CREATED event, and the quote linked to it with its CONVERTED event, in one batch. Only a VALID
 * quote converts; what's short comes back once, unless `force` («Guardar de todos modos»).
 */
export async function convertQuote(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult | ShortageWarning> {
	requireRole(actor, TAKES_QUOTES);
	const parsed = conversionInputSchema.safeParse(input);
	const row = parsed.success ? await findRow(db, parsed.data.quote) : null;
	if (!parsed.success || null === row) {
		return NOT_FOUND;
	}
	const quote = toQuote(row);
	if ('CONVERTED' === quote.state) {
		return ALREADY_CONVERTED;
	}
	if ('EXPIRED' === quote.state) {
		return EXPIRED;
	}
	const { order: form, force } = parsed.data;
	const order = await prepareQuotedOrder(db, form, { actor, quotedItems: quote.items, force });
	if ('ok' in order) {
		return order;
	}
	// ponytail: two saves racing on one quote both pass the check above; a guarded link if it ever happens.
	const link = linkStatements(db, actor, { row, publicToken: order.publicToken });
	const results = await db.batch([...order.statements, ...link]);
	return { ok: true, id: results[order.insertAt].meta.last_row_id };
}

/**
 * The token of the quote's client page, for «Copiar enlace del cliente», in any state. Kept out of
 * `getQuote`: no staff screen shows it as text.
 */
export async function getQuotePublicToken(
	db: D1Database,
	id: number,
	actor: Actor | null
): Promise<string | null> {
	requireRole(actor, TAKES_QUOTES);
	const row = await db
		.prepare('select public_token from quotes where id = ?')
		.bind(id)
		.first<{ public_token: string }>();
	return row?.public_token ?? null;
}

/** The quote order `orderId` came from, read through `quotes.order_id`: null for most orders. */
export async function getSourceQuoteId(
	db: D1Database,
	orderId: number,
	actor: Actor | null
): Promise<number | null> {
	requireRole(actor, TAKES_QUOTES);
	const row = await db
		.prepare('select id from quotes where order_id = ?')
		.bind(orderId)
		.first<{ id: number }>();
	return row?.id ?? null;
}

/**
 * The half-letter quote, in any state. `document` is the contact's NIT or cédula as it is when
 * printed, or null when it's an automatic one: nothing prints in its place.
 */
export type QuotePrintout = { quote: Quote; document: string | null; company: CompanySettings };

export async function getQuotePrintout(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<QuotePrintout | null> {
	requireRole(actor, TAKES_QUOTES);
	const [quote, company] = await Promise.all([
		getQuote(db, id, actor),
		readSettings(db, COMPANY_SETTINGS)
	]);
	if (null === quote) {
		return null;
	}
	const contact = await db
		.prepare('select document_id from contacts where id = ?')
		.bind(quote.clientId)
		.first<{ document_id: string }>();
	const documentId = contact?.document_id ?? null;
	const document = null === documentId || isAutoDocument(documentId) ? null : documentId;
	return { quote, document, company };
}
