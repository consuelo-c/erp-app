// The client's side of an order, with no session: the lookup by phone and event date, and its page
// through `public_token`, never the order's id. No actor and no writes: a client isn't a login, and reads aren't logged.

import { z } from 'zod';
import { addDays, getTodaysDate } from '$lib/datetime';
import { normalizePhone } from '$lib/phone';
import {
	BALANCE_DUE_SQL,
	clientAttributesSchema,
	deliveryAttributesSchema,
	orderItemsSchema,
	pickupAttributesSchema,
	type DeliveryMethod,
	type OrderItem,
	type OrderStatus,
	type ReturnMethod
} from './orders';
import { readSettings } from './settings';

/** How many days after its event a client still sees the order. A constant, not a setting. */
export const LOOKUP_WINDOW_DAYS = 7;

/** The earliest event a client still finds: Bogotá's today less the window. */
export function getLookupWindowStart(): string {
	return addDays(getTodaysDate(), -LOOKUP_WINDOW_DAYS);
}

// Every token is a `crypto.randomUUID()`: anything else, an order's id included, is no order.
const tokenSchema = z.guid();

type PublicItem = Pick<OrderItem, 'name' | 'qty' | 'unit_price' | 'line_total'>;

/** Exactly what the client's page shows: no carrier, times, notes, list prices, phone or payments. */
export type PublicOrder = {
	id: number;
	status: OrderStatus;
	clientName: string;
	eventDate: string;
	deliveryDate: string;
	pickupDate: string;
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
};

type PublicOrderRow = {
	id: number;
	status: OrderStatus;
	event_date: string;
	delivery_date: string;
	pickup_date: string;
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
		deliveryDate: row.delivery_date,
		pickupDate: row.pickup_date,
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
		balanceDue: row.balance_due
	};
}

/**
 * The client's page: null for an unknown token, a draft, or an event more than
 * `LOOKUP_WINDOW_DAYS` past, so a saved link stops showing the order a week after it.
 */
export async function getPublicOrder(db: D1Database, token: unknown): Promise<PublicOrder | null> {
	const parsed = tokenSchema.safeParse(token);
	if (!parsed.success) {
		return null;
	}
	const row = await db
		.prepare(
			`select id, status, event_date, delivery_date, pickup_date, rental_days, client_attributes,
			delivery_attributes, pickup_attributes, order_items, items_total, discount, transport_cost,
			order_total, deposit_amount, ${BALANCE_DUE_SQL} as balance_due
			from orders where public_token = ? and status <> 'DRAFT' and event_date >= ?`
		)
		.bind(parsed.data, getLookupWindowStart())
		.first<PublicOrderRow>();
	return null === row ? null : toPublicOrder(row);
}

/**
 * The order a client link names, whatever its status or date, for an employee opening it from
 * the client's WhatsApp: the window and the draft rule protect the client's page, not the staff's.
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

/** The public pages' only contact: `wa.me` with `text` pre-filled, or null while it's empty. */
export async function getWhatsAppHref(db: D1Database, text: string): Promise<string | null> {
	const { COMPANY_WHATSAPP: number } = await readSettings(db, ['COMPANY_WHATSAPP']);
	return '' === number ? null : `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

const lookupSchema = z.object({
	phone: z.string().transform((typed, context) => {
		const phone = normalizePhone(typed);
		if (null === phone) {
			context.addIssue({
				code: 'custom',
				message: 'Escriba el teléfono con el que hizo el pedido'
			});
			return z.NEVER;
		}
		return phone;
	}),
	event_date: z.iso.date('Escoja la fecha del evento')
});

/** One of the lookup's matches, as its list names it and links to its page. */
export type LookupMatch = { id: number; status: OrderStatus; token: string };

export type LookupResult =
	| { ok: true; matches: LookupMatch[] }
	| { ok: false; errors: Partial<Record<'phone' | 'event_date', string>> };

/**
 * The orders of a phone and an event date, by `id`: the phone compared whole against the order's
 * own snapshot, never `contacts.phone`; every status but a draft; an event no older than the
 * window. No match is the one miss, whatever failed; a field the client mistyped runs no query.
 */
export async function lookupOrders(db: D1Database, input: unknown): Promise<LookupResult> {
	const parsed = lookupSchema.safeParse(input);
	if (!parsed.success) {
		const errors = Object.fromEntries(
			parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])
		);
		return { ok: false, errors };
	}
	const { results } = await db
		.prepare(
			`select id, status, public_token as token from orders
			where status <> 'DRAFT' and event_date = ? and event_date >= ?
			and json_extract(client_attributes, '$.phone') = ? order by id`
		)
		.bind(parsed.data.event_date, getLookupWindowStart(), parsed.data.phone)
		.all<LookupMatch>();
	return { ok: true, matches: results };
}
