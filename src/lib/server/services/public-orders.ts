// The client's side of an order, with no session: the lookup by phone or WhatsApp username and event date, and its page
// through `public_token`, never the order's id; a quote's page too, only through its own token. No actor and no writes: a client isn't a login, and reads aren't logged.

import { z } from 'zod';
import { addDays, getInstantDate, getTodaysDate } from '$lib/datetime';
import { normalizePhone } from '$lib/phone';
import { normalizeWhatsapp } from '$lib/whatsapp';
import {
	BALANCE_DUE_SQL,
	clientAttributesSchema,
	deliveryAttributesSchema,
	ORDER_RECEIVABLE_BALANCE_SQL,
	orderItemsSchema,
	pickupAttributesSchema,
	type DeliveryMethod,
	type OrderItem,
	type OrderStatus,
	type ReturnMethod
} from './orders';
import { SELECT_QUOTE, toQuote, type QuoteRow } from './quotes';
import { readSettings } from './settings';

/** How many days after its event a client still sees the order. A constant, not a setting. */
export const LOOKUP_WINDOW_DAYS = 30;

/** The earliest event a client still finds: Bogotá's today less the window. */
export function getLookupWindowStart(): string {
	return addDays(getTodaysDate(), -LOOKUP_WINDOW_DAYS);
}

// Every token is a `crypto.randomUUID()`: anything else, an order's id included, is no order.
const tokenSchema = z.guid();

type PublicItem = Pick<OrderItem, 'name' | 'qty' | 'unit_price' | 'line_total'>;

/**
 * Exactly what the client's page shows: no carrier, delivery or pickup dates, times, notes, list
 * prices, phone or payments.
 */
export type PublicOrder = {
	id: number;
	status: OrderStatus;
	clientName: string;
	eventDate: string;
	rentalDays: number;
	delivery: { method: DeliveryMethod; address_1: string; address_2: string | null };
	pickup: { method: ReturnMethod };
	items: PublicItem[];
	itemsTotal: number;
	discount: number;
	transportCost: number;
	orderTotal: number;
	depositAmount: number;
	paid: number;
	balanceDue: number;
	/** The cuenta de cobro billing it: only its balance line reaches the page, never a link. */
	receivableId: number | null;
	receivableBalance: number | null;
};

type PublicOrderRow = {
	id: number;
	status: OrderStatus;
	event_date: string;
	rental_days: number;
	client_attributes: string;
	delivery_attributes: string;
	pickup_attributes: string;
	order_items: string;
	items_total: number;
	discount: number;
	transport_cost: number;
	order_total: number;
	deposit_amount: number;
	balance_due: number;
	receivable_id: number | null;
	receivable_balance: number | null;
};

// A line as the client's paper prints it: never the list price.
function toPublicItem(item: OrderItem): PublicItem {
	return {
		name: item.name,
		qty: item.qty,
		unit_price: item.unit_price,
		line_total: item.line_total
	};
}

function toPublicOrder(row: PublicOrderRow): PublicOrder {
	const delivery = deliveryAttributesSchema.parse(JSON.parse(row.delivery_attributes));
	const pickup = pickupAttributesSchema.parse(JSON.parse(row.pickup_attributes));
	return {
		id: row.id,
		status: row.status,
		clientName: clientAttributesSchema.parse(JSON.parse(row.client_attributes)).name,
		eventDate: row.event_date,
		rentalDays: row.rental_days,
		delivery: {
			method: delivery.method,
			address_1: delivery.address_1,
			address_2: delivery.address_2
		},
		pickup: { method: pickup.method },
		items: orderItemsSchema.parse(JSON.parse(row.order_items)).map(toPublicItem),
		itemsTotal: row.items_total,
		discount: row.discount,
		transportCost: row.transport_cost,
		orderTotal: row.order_total,
		depositAmount: row.deposit_amount,
		paid: row.order_total - row.balance_due,
		balanceDue: row.balance_due,
		receivableId: row.receivable_id,
		receivableBalance: row.receivable_balance
	};
}

/**
 * The client's page: null for an unknown token, or an event more than
 * `LOOKUP_WINDOW_DAYS` past, so a saved link stops showing the order a month after it.
 */
export async function getPublicOrder(db: D1Database, token: unknown): Promise<PublicOrder | null> {
	const parsed = tokenSchema.safeParse(token);
	if (!parsed.success) {
		return null;
	}
	const row = await db
		.prepare(
			`select id, status, event_date, rental_days, client_attributes, delivery_attributes,
			pickup_attributes, order_items, items_total, discount, transport_cost, order_total,
			deposit_amount, ${BALANCE_DUE_SQL} as balance_due, receivable_id,
			${ORDER_RECEIVABLE_BALANCE_SQL} as receivable_balance
			from orders where public_token = ? and event_date >= ?`
		)
		.bind(parsed.data, getLookupWindowStart())
		.first<PublicOrderRow>();
	return null === row ? null : toPublicOrder(row);
}

/**
 * The order a client link names, whatever its status or date, for an employee opening it from
 * the client's WhatsApp: the window protects the client's page, not the staff's.
 */
export async function findOrderIdByToken(db: D1Database, token: unknown): Promise<number | null> {
	const parsed = tokenSchema.safeParse(token);
	if (!parsed.success) {
		return null;
	}
	const row = await db
		.prepare('select id from orders where public_token = ?')
		.bind(parsed.data)
		.first<{ id: number }>();
	return row?.id ?? null;
}

/**
 * Exactly what «Su cotización» shows, built here and not trimmed in the page: never the phone, the
 * document, `client_id`, the list prices, who created or edited it, or its timeline.
 */
export type PublicQuote = {
	id: number;
	createdOn: string;
	validUntil: string;
	clientName: string;
	eventDate: string | null;
	address1: string | null;
	address2: string | null;
	rentalDays: number;
	items: PublicItem[];
	itemsTotal: number;
	discount: number;
	/** Null is «por acordar»: the total leaves it out. */
	transportCost: number | null;
	quoteTotal: number;
	notes: string | null;
};

async function findQuoteByToken(db: D1Database, token: unknown) {
	const parsed = tokenSchema.safeParse(token);
	if (!parsed.success) {
		return null;
	}
	const row = await db
		.prepare(`${SELECT_QUOTE} where public_token = ?`)
		.bind(parsed.data)
		.first<QuoteRow>();
	return null === row ? null : toQuote(row);
}

/**
 * The client's quote page: null for an unknown token, or a quote that isn't VALID. Renewing an
 * expired quote brings the same link back; a converted one never leads to its order.
 */
export async function getPublicQuote(db: D1Database, token: unknown): Promise<PublicQuote | null> {
	const quote = await findQuoteByToken(db, token);
	if (null === quote || 'VALID' !== quote.state) {
		return null;
	}
	const { id, validUntil, eventDate, address1, address2, rentalDays, notes } = quote;
	const { itemsTotal, discount, transportCost, quoteTotal } = quote;
	return {
		id,
		createdOn: getInstantDate(quote.createdAt),
		validUntil,
		clientName: quote.client.name,
		eventDate,
		address1,
		address2,
		rentalDays,
		items: quote.items.map((item) => ({
			name: item.name,
			qty: item.qty,
			unit_price: item.unit_price,
			line_total: item.line_total
		})),
		itemsTotal,
		discount,
		transportCost,
		quoteTotal,
		notes
	};
}

/** The quote a client link names, in any state, for an employee opening it: they go to its detail. */
export async function findQuoteIdByToken(db: D1Database, token: unknown): Promise<number | null> {
	return (await findQuoteByToken(db, token))?.id ?? null;
}

/** The terms and conditions under the order, as Markdown; empty while there are none. */
export async function getClientTerms(db: D1Database): Promise<string> {
	const { TERMS_CONDITIONS: text } = await readSettings(db, ['TERMS_CONDITIONS']);
	return text;
}

/** The public pages' only contact: `wa.me` with `text` pre-filled, or null while it's empty. */
export async function getWhatsAppHref(db: D1Database, text: string): Promise<string | null> {
	const { COMPANY_WHATSAPP: number } = await readSettings(db, ['COMPANY_WHATSAPP']);
	return '' === number ? null : `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

const UNKNOWN_REACH = 'Escriba el teléfono o el usuario de WhatsApp con el que hizo el pedido.';

/** What the client typed, as the order stores it: a username when it has a letter, else a phone. */
type Reach = { column: '$.phone' | '$.whatsapp'; value: string };

const lookupSchema = z.object({
	phone_or_username: z.string().transform((typed, context): Reach => {
		const isUsername = /[a-z]/i.test(typed);
		const value = isUsername ? normalizeWhatsapp(typed) : normalizePhone(typed);
		if (null === value) {
			context.addIssue({ code: 'custom', message: UNKNOWN_REACH });
			return z.NEVER;
		}
		return { column: isUsername ? '$.whatsapp' : '$.phone', value };
	}),
	event_date: z.iso.date('Escoja la fecha del evento')
});

/** One of the lookup's matches, as its list names it and links to its page. */
export type LookupMatch = { id: number; status: OrderStatus; token: string };

export type LookupResult =
	| { ok: true; matches: LookupMatch[] }
	| { ok: false; errors: Partial<Record<'phone_or_username' | 'event_date', string>> };

/**
 * The orders of a phone or a WhatsApp username and an event date, by `id`: compared against the
 * order's own snapshot, never the contact; the phone whole, the username ignoring case; every
 * status; an event no older than the window. No match is the one miss, whatever failed; a field
 * the client mistyped runs no query.
 */
export async function lookupOrders(db: D1Database, input: unknown): Promise<LookupResult> {
	const parsed = lookupSchema.safeParse(input);
	if (!parsed.success) {
		const errors = Object.fromEntries(
			parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])
		);
		return { ok: false, errors };
	}
	const { column, value } = parsed.data.phone_or_username;
	const { results } = await db
		.prepare(
			`select id, status, public_token as token from orders
			where event_date = ? and event_date >= ?
			and lower(json_extract(client_attributes, ?)) = lower(?) order by id`
		)
		.bind(parsed.data.event_date, getLookupWindowStart(), column, value)
		.all<LookupMatch>();
	return { ok: true, matches: results };
}
