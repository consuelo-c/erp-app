// Pedidos: an order, its client's snapshot, its two trips and its lines. Created on an existing
// client, edited from DRAFT through DELIVERED, never deleted. Availability and the form's warnings
// only inform: nothing here blocks on them.

import { z } from 'zod';
import { calculateOrderTotals, type OrderTotals, type PricedLine } from '$lib/orders';
import { requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate } from '../audit';
import { readSettings } from './settings';

// The commercial side: whoever takes orders creates and edits them.
const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;

export const ORDER_STATUSES = [
	'DRAFT',
	'CONFIRMED',
	'PICKED',
	'OUT_FOR_DELIVERY',
	'DELIVERED',
	'OUT_FOR_PICKUP',
	'COMPLETED',
	'CANCELLED'
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Once the products are on their way back, or the order was cancelled, it's read-only.
const EDITABLE_STATUSES: readonly OrderStatus[] = [
	'DRAFT',
	'CONFIRMED',
	'PICKED',
	'OUT_FOR_DELIVERY',
	'DELIVERED'
];

/** Two independent axes: the client may pick up and the company go get it back, or the reverse. */
export const DELIVERY_METHODS = ['COMPANY_DELIVERY', 'CLIENT_PICKUP', 'EXTERNAL_CARRIER'] as const;
export const RETURN_METHODS = ['COMPANY_PICKUP', 'CLIENT_RETURN', 'EXTERNAL_CARRIER'] as const;

export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export type ReturnMethod = (typeof RETURN_METHODS)[number];

function isExternalCarrier(method: string): boolean {
	return 'EXTERNAL_CARRIER' === method;
}

const idSchema = z.number().int().positive();
const pesosSchema = z.number().int().min(0);
const textSchema = z.string().min(1);
const clockTimeSchema = z.iso.time({ precision: -1 });

// SQLite validates nothing: each JSON is checked on write and on read. A new key is a code change.
export const clientAttributesSchema = z.strictObject({ name: textSchema, phone: textSchema });

const carrierSchema = z.strictObject({ id: idSchema, name: textSchema, phone: textSchema });

function tripSchema<Methods extends readonly [string, ...string[]]>(methods: Methods) {
	return z
		.strictObject({
			method: z.enum(methods),
			time: clockTimeSchema.nullable(),
			address_1: textSchema,
			address_2: textSchema.nullable(),
			carrier: carrierSchema.nullable(),
			notes: textSchema.nullable() // the driver's, written from Phase 10
		})
		.refine(
			(trip) => isExternalCarrier(trip.method) === (null !== trip.carrier),
			'Only an external carrier is a carrier'
		);
}

export const deliveryAttributesSchema = tripSchema(DELIVERY_METHODS);
export const pickupAttributesSchema = tripSchema(RETURN_METHODS);

export const orderAttributesSchema = z.strictObject({
	parent_order_id: idSchema.optional(),
	notes: textSchema.optional()
});

// Adding a product again goes to its line: each product appears once.
function hasDistinctProducts(lines: { product_id: number }[]): boolean {
	return new Set(lines.map((line) => line.product_id)).size === lines.length;
}

const ONE_LINE_PER_PRODUCT = 'Ese producto ya está en otra línea: cambia su cantidad';
const AT_LEAST_ONE_LINE = 'Agrega al menos un producto';

const qtySchema = z.number('Escribe la cantidad').int().min(1, 'La cantidad es al menos 1');

// A $0 line is a courtesy, not a mistake.
const orderItemSchema = z.strictObject({
	product_id: idSchema,
	name: textSchema, // frozen when the line is added
	qty: qtySchema,
	list_price: pesosSchema, // frozen when the line is added
	unit_price: pesosSchema,
	line_total: pesosSchema
});

export const orderItemsSchema = z
	.array(orderItemSchema)
	.min(1, AT_LEAST_ONE_LINE)
	.refine(hasDistinctProducts, ONE_LINE_PER_PRODUCT);

export type ClientAttributes = z.infer<typeof clientAttributesSchema>;
export type Carrier = z.infer<typeof carrierSchema>;
export type DeliveryAttributes = z.infer<typeof deliveryAttributesSchema>;
export type PickupAttributes = z.infer<typeof pickupAttributesSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;

function pesosInputSchema(message: string) {
	return z.number(message).int(message).min(0, 'No puede ser negativo').default(0);
}

const blankable = z
	.string()
	.trim()
	.nullish()
	.transform((value) => value || null);

// The service fills the carrier's name and phone, and the line's name and list price.
function tripInputSchema<Methods extends readonly [string, ...string[]]>(
	methods: Methods,
	message: string
) {
	return z
		.object({
			method: z.enum(methods, message),
			time: clockTimeSchema.nullable().default(null),
			address_1: z.string('Escribe la dirección').trim().min(1, 'Escribe la dirección'),
			address_2: blankable,
			carrier_id: idSchema.nullable().default(null)
		})
		.refine((trip) => !isExternalCarrier(trip.method) || null !== trip.carrier_id, {
			message: 'Escoge el transportador',
			path: ['carrier_id']
		});
}

const lineInputSchema = z.strictObject({
	product_id: idSchema,
	qty: qtySchema,
	unit_price: z.number('Escribe el precio').int().min(0, 'El precio no puede ser negativo')
});

// Any total sent along is ignored: the service works them out.
const orderInputSchema = z
	.object({
		client_id: z.number('Escoge el cliente').int().positive('Escoge el cliente'),
		event_date: z.iso.date('Escoge la fecha del evento'),
		delivery_date: z.iso.date('Escoge la fecha de entrega'),
		pickup_date: z.iso.date('Escoge la fecha de recogida'),
		rental_days: z.number('Escribe los días cobrados').int().min(1, 'Se cobra al menos un día'),
		delivery_attributes: tripInputSchema(DELIVERY_METHODS, 'Escoge cómo se entrega'),
		pickup_attributes: tripInputSchema(RETURN_METHODS, 'Escoge cómo se recoge'),
		order_items: z
			.array(lineInputSchema)
			.min(1, AT_LEAST_ONE_LINE)
			.refine(hasDistinctProducts, ONE_LINE_PER_PRODUCT),
		discount: pesosInputSchema('Escribe el descuento en pesos'),
		transport_cost: pesosInputSchema('Escribe el transporte en pesos'),
		deposit_amount: pesosInputSchema('Escribe el depósito en pesos'),
		notes: blankable
	})
	// The event date isn't checked: the event can fall anywhere around the trips.
	.refine((order) => order.delivery_date <= order.pickup_date, {
		message: 'La recogida no puede ser antes de la entrega',
		path: ['pickup_date']
	})
	// The discount comes off the items only, never off transport.
	.refine((order) => order.discount <= totalsOf(order).itemsTotal, {
		message: 'El descuento no puede ser mayor que el subtotal',
		path: ['discount']
	});

const idInputSchema = z.object({ id: z.coerce.number().int().positive() });

type OrderInput = z.output<typeof orderInputSchema>;
type TripInput = OrderInput['delivery_attributes'] | OrderInput['pickup_attributes'];
type LineInput = OrderInput['order_items'][number];
type Trip = Omit<DeliveryAttributes, 'method'> & { method: string };

type PricedOrder = {
	order_items: PricedLine[];
	rental_days: number;
	discount: number;
	transport_cost: number;
};

function totalsOf(order: PricedOrder): OrderTotals {
	return calculateOrderTotals({
		lines: order.order_items,
		rentalDays: order.rental_days,
		discount: order.discount,
		transportCost: order.transport_cost
	});
}

export type Order = {
	id: number;
	status: OrderStatus;
	hasIncident: boolean;
	clientId: number;
	client: ClientAttributes;
	eventDate: string;
	deliveryDate: string;
	pickupDate: string;
	rentalDays: number;
	delivery: DeliveryAttributes;
	pickup: PickupAttributes;
	items: OrderItem[];
	itemsTotal: number;
	discount: number;
	transportCost: number;
	orderTotal: number;
	depositAmount: number;
	notes: string | null;
	parentOrderId: number | null;
};

export type SaveResult =
	{ ok: true; id: number } | { ok: false; message: string; errors: Record<string, string> };

type Refusal = Extract<SaveResult, { ok: false }>;

type Columns = {
	client_id: number;
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
	attributes: string;
};

type OrderRow = Columns & { id: number; status: OrderStatus; has_incident: number };

const SELECT_ORDER = `select id, status, has_incident, client_id, event_date, delivery_date,
	pickup_date, rental_days, client_attributes, delivery_attributes, pickup_attributes, order_items,
	items_total, discount, transport_cost, order_total, deposit_amount, attributes from orders`;

const CHECK_FIELDS = 'Revisa los campos marcados en rojo antes de guardar.';
const NOT_A_CARRIER = 'Escoge un transportador de la lista';

function refusal(field: string, message: string): Refusal {
	return { ok: false, message: CHECK_FIELDS, errors: { [field]: message } };
}

/** Each field's message under its whole path, as `order_items.2.qty` or `delivery_attributes.carrier_id`. */
function invalidOrder(zodError: z.ZodError): Refusal {
	const errors = Object.fromEntries(
		zodError.issues.map((issue) => [issue.path.join('.'), issue.message])
	);
	return { ok: false, message: CHECK_FIELDS, errors };
}

function toOrder(row: OrderRow): Order {
	const attributes = orderAttributesSchema.parse(JSON.parse(row.attributes));
	return {
		id: row.id,
		status: row.status,
		hasIncident: 1 === row.has_incident,
		clientId: row.client_id,
		client: clientAttributesSchema.parse(JSON.parse(row.client_attributes)),
		eventDate: row.event_date,
		deliveryDate: row.delivery_date,
		pickupDate: row.pickup_date,
		rentalDays: row.rental_days,
		delivery: deliveryAttributesSchema.parse(JSON.parse(row.delivery_attributes)),
		pickup: pickupAttributesSchema.parse(JSON.parse(row.pickup_attributes)),
		items: orderItemsSchema.parse(JSON.parse(row.order_items)),
		itemsTotal: row.items_total,
		discount: row.discount,
		transportCost: row.transport_cost,
		orderTotal: row.order_total,
		depositAmount: row.deposit_amount,
		notes: attributes.notes ?? null,
		parentOrderId: attributes.parent_order_id ?? null
	};
}

async function findRow(db: D1Database, id: number): Promise<OrderRow | null> {
	return db.prepare(`${SELECT_ORDER} where id = ?`).bind(id).first<OrderRow>();
}

// The order keeps what the client was called when picked: renaming the contact later changes nothing.
async function snapshotClient(
	db: D1Database,
	clientId: number,
	current: Order | null
): Promise<ClientAttributes | null> {
	if (clientId === current?.clientId) {
		return current.client;
	}
	return db
		.prepare('select full_name as name, phone from contacts where id = ?')
		.bind(clientId)
		.first<ClientAttributes>();
}

// A JSON key has no foreign key: the carrier must be a contact offering TRANSPORTER. One already
// on the trip keeps its snapshot, as the client does.
async function snapshotCarrier(
	db: D1Database,
	carrierId: number,
	current: Carrier | null
): Promise<Carrier | null> {
	if (carrierId === current?.id) {
		return current;
	}
	return db
		.prepare(
			`select id, full_name as name, phone from contacts where id = ?
			and exists (select 1 from json_each(contacts.services) where value = 'TRANSPORTER')`
		)
		.bind(carrierId)
		.first<Carrier>();
}

/** The trip to store, or null when its carrier isn't a transporter. The driver's note is kept. */
async function resolveTrip(
	db: D1Database,
	trip: TripInput,
	current: Trip | null
): Promise<Trip | null> {
	const { carrier_id, ...details } = trip;
	const notes = current?.notes ?? null;
	if (!isExternalCarrier(trip.method)) {
		return { ...details, carrier: null, notes };
	}
	const carrier = await snapshotCarrier(db, carrier_id ?? 0, current?.carrier ?? null);
	return null === carrier ? null : { ...details, carrier, notes };
}

type FrozenLine = { name: string; list_price: number };

// A new line takes the catalog's name and price; an inactive product can't be added.
async function readCatalog(db: D1Database, productIds: number[]): Promise<Map<number, FrozenLine>> {
	if (0 === productIds.length) {
		return new Map();
	}
	const { results } = await db
		.prepare(
			`select id, name, rental_price as list_price from products
			where active = 1 and id in (select value from json_each(?))`
		)
		.bind(JSON.stringify(productIds))
		.all<FrozenLine & { id: number }>();
	return new Map(results.map(({ id, ...frozen }) => [id, frozen]));
}

// A line already on the order keeps the name and price it froze with: the product may have been
// renamed, repriced or deactivated since.
async function freezeLines(
	db: D1Database,
	lines: LineInput[],
	currentItems: OrderItem[]
): Promise<Map<number, FrozenLine>> {
	const frozen = new Map(
		currentItems.map((item) => [item.product_id, { name: item.name, list_price: item.list_price }])
	);
	const added = lines.map((line) => line.product_id).filter((id) => !frozen.has(id));
	return new Map([...frozen, ...(await readCatalog(db, added))]);
}

async function resolveItems(
	db: D1Database,
	order: OrderInput,
	currentItems: OrderItem[]
): Promise<OrderItem[] | Refusal> {
	const frozen = await freezeLines(db, order.order_items, currentItems);
	const missing = order.order_items.findIndex((line) => !frozen.has(line.product_id));
	if (-1 !== missing) {
		return refusal(`order_items.${missing}.product_id`, 'Ese producto no existe o está inactivo');
	}
	const { lineTotals } = totalsOf(order);
	return order.order_items.map((line, index) => {
		const { name, list_price } = frozen.get(line.product_id) as FrozenLine;
		const { product_id, qty, unit_price } = line;
		return { product_id, name, qty, list_price, unit_price, line_total: lineTotals[index] };
	});
}

type Resolved = {
	client: ClientAttributes;
	delivery: Trip;
	pickup: Trip;
	items: OrderItem[];
	parentOrderId: number | null;
};

// Through the schemas, so the JSON always has the same keys in the same order: an edit that
// changes nothing produces the same text and logs nothing.
function toColumns(order: OrderInput, resolved: Resolved): Columns {
	const { itemsTotal, orderTotal } = totalsOf(order);
	const attributes = {
		parent_order_id: resolved.parentOrderId ?? undefined,
		notes: order.notes ?? undefined
	};
	return {
		client_id: order.client_id,
		event_date: order.event_date,
		delivery_date: order.delivery_date,
		pickup_date: order.pickup_date,
		rental_days: order.rental_days,
		client_attributes: JSON.stringify(clientAttributesSchema.parse(resolved.client)),
		delivery_attributes: JSON.stringify(deliveryAttributesSchema.parse(resolved.delivery)),
		pickup_attributes: JSON.stringify(pickupAttributesSchema.parse(resolved.pickup)),
		order_items: JSON.stringify(orderItemsSchema.parse(resolved.items)),
		items_total: itemsTotal,
		discount: order.discount,
		transport_cost: order.transport_cost,
		order_total: orderTotal,
		deposit_amount: order.deposit_amount,
		attributes: JSON.stringify(orderAttributesSchema.parse(attributes))
	};
}

async function resolveTrips(
	db: D1Database,
	order: OrderInput,
	current: Order | null
): Promise<{ delivery: Trip; pickup: Trip } | Refusal> {
	const delivery = await resolveTrip(db, order.delivery_attributes, current?.delivery ?? null);
	if (null === delivery) {
		return refusal('delivery_attributes.carrier_id', NOT_A_CARRIER);
	}
	const pickup = await resolveTrip(db, order.pickup_attributes, current?.pickup ?? null);
	if (null === pickup) {
		return refusal('pickup_attributes.carrier_id', NOT_A_CARRIER);
	}
	return { delivery, pickup };
}

/** The columns to store for `order`, or why it can't be saved. `current` is the order being edited. */
async function resolveColumns(
	db: D1Database,
	order: OrderInput,
	current: Order | null
): Promise<Columns | Refusal> {
	const client = await snapshotClient(db, order.client_id, current);
	if (null === client) {
		return refusal('client_id', 'Ese cliente no existe');
	}
	const trips = await resolveTrips(db, order, current);
	if ('ok' in trips) {
		return trips;
	}
	const items = await resolveItems(db, order, current?.items ?? []);
	if ('ok' in items) {
		return items;
	}
	const parentOrderId = current?.parentOrderId ?? null;
	return toColumns(order, { client, ...trips, items, parentOrderId });
}

export async function getOrder(
	db: D1Database,
	id: number,
	actor: Actor | null
): Promise<Order | null> {
	requireRole(actor, TAKES_ORDERS);
	const row = await findRow(db, id);
	return null === row ? null : toOrder(row);
}

/** A new order on an existing client, born a draft: confirming is a step of its own. */
export async function createOrder(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, TAKES_ORDERS);
	const parsed = orderInputSchema.safeParse(input);
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	const columns = await resolveColumns(db, parsed.data, null);
	if ('ok' in columns) {
		return columns;
	}
	// The public lookup's key: it stays out of events, which every role's timeline reads.
	const statements = auditedInsert(db, {
		table: 'orders',
		entityType: 'ORDER',
		actor,
		values: { ...columns, status: 'DRAFT' },
		unlogged: { public_token: crypto.randomUUID() }
	});
	const [inserted] = await db.batch(statements);
	return { ok: true, id: inserted.meta.last_row_id };
}

const NOT_FOUND: Refusal = { ok: false, message: 'Ese pedido no existe', errors: {} };

const NOT_EDITABLE: Refusal = {
	ok: false,
	message: 'Este pedido ya no se puede editar: está en recogida, completado o cancelado',
	errors: {}
};

// `order_items` and each JSON column are logged whole when anything in them changed.
async function applyEdit(
	db: D1Database,
	actor: Actor,
	{ row, columns }: { row: OrderRow; columns: Columns }
): Promise<SaveResult> {
	const statements = auditedUpdate(db, {
		table: 'orders',
		entityType: 'ORDER',
		actor,
		id: row.id,
		current: row,
		changes: columns
	});
	if (0 < statements.length) {
		await db.batch(statements);
	}
	return { ok: true, id: row.id };
}

/** The whole form, from DRAFT through DELIVERED. Lines already on it keep their frozen name and price. */
export async function updateOrder(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, TAKES_ORDERS);
	const parsedId = idInputSchema.safeParse(input);
	const parsed = orderInputSchema.safeParse(input);
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
	if (!EDITABLE_STATUSES.includes(row.status)) {
		return NOT_EDITABLE;
	}
	const columns = await resolveColumns(db, parsed.data, toOrder(row));
	return 'ok' in columns ? columns : applyEdit(db, actor, { row, columns });
}

// The orders whose products are out of the warehouse, or promised: a draft doesn't hold them yet,
// and a cancelled or completed order no longer does, so cancelling releases them on its own.
const RESERVING_STATUSES: readonly OrderStatus[] = [
	'CONFIRMED',
	'PICKED',
	'OUT_FOR_DELIVERY',
	'DELIVERED',
	'OUT_FOR_PICKUP'
];

// An order is never deleted and there's no other to edit: `order_id` is the one being edited.
const editedOrderSchema = z.coerce.number().int().positive().nullable().default(null);

const tripDatesSchema = z
	.object({
		order_id: editedOrderSchema,
		delivery_date: z.iso.date(),
		pickup_date: z.iso.date()
	})
	.refine((trips) => trips.delivery_date <= trips.pickup_date, 'The pickup is before the delivery');

const availabilitySchema = tripDatesSchema.safeExtend({
	product_ids: z.array(z.coerce.number().int().positive())
});

/** What's left of a product on the range's tightest day. Negative when it's overbooked: never clamped. */
export type Availability = { productId: number; available: number };

// The block covers every day from delivery to pickup, both included. Each day subtracts the lines
// of the reserving orders whose range holds it; a line's availability is its range's lowest day.
const AVAILABILITY_SQL = `with recursive days(day) as (
		select ?1 union all select date(day, '+1 day') from days where day < ?2
	),
	reserved(product_id, day, qty) as (
		select json_extract(item.value, '$.product_id'), days.day,
			sum(cast(json_extract(item.value, '$.qty') as integer))
		from days
		join orders on orders.delivery_date <= days.day and orders.pickup_date >= days.day
		join json_each(orders.order_items) as item
		where orders.status in (select value from json_each(?3)) and orders.id is not ?4
		group by 1, 2
	)
	select products.id as productId,
		min(products.total_quantity - coalesce(reserved.qty, 0)) as available
	from products
	join days
	left join reserved on reserved.product_id = products.id and reserved.day = days.day
	where products.id in (select value from json_each(?5))
	group by products.id`;

/**
 * Each product's availability for the range: a live query, never a reservation or a lock. It only
 * informs: nothing blocks on it. The order being edited leaves its own lines out.
 */
export async function getAvailability(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Availability[]> {
	requireRole(actor, TAKES_ORDERS);
	const range = availabilitySchema.parse(input);
	const { results } = await db
		.prepare(AVAILABILITY_SQL)
		.bind(
			range.delivery_date,
			range.pickup_date,
			JSON.stringify(RESERVING_STATUSES),
			range.order_id,
			JSON.stringify(range.product_ids)
		)
		.all<Availability>();
	return results;
}

export type TripKind = 'DELIVERY' | 'PICKUP';

/** A trip on a holiday in `PAYROLL_HOLIDAYS`: the truck goes out or comes back that day. */
export type HolidayWarning = { trip: TripKind; date: string; label: string };

/** Another order with a delivery or pickup on this trip's date and time. */
export type ScheduleClash = { trip: TripKind; orderId: number; clientName: string };

export type OrderWarnings = { holidays: HolidayWarning[]; clashes: ScheduleClash[] };

const warningsSchema = tripDatesSchema.safeExtend({
	delivery_time: clockTimeSchema.nullable().default(null),
	pickup_time: clockTimeSchema.nullable().default(null)
});

type TripSlot = { trip: TripKind; date: string; time: string | null };

// Only the trips: the event date isn't checked.
async function findHolidayWarnings(db: D1Database, slots: TripSlot[]): Promise<HolidayWarning[]> {
	const { PAYROLL_HOLIDAYS: holidays } = await readSettings(db, ['PAYROLL_HOLIDAYS']);
	return slots.flatMap(({ trip, date }) =>
		holidays.filter((holiday) => date === holiday.date).map(({ label }) => ({ trip, date, label }))
	);
}

// A time left empty never clashes. A cancelled order makes no trip, and an order never clashes
// with itself.
async function findClashes(
	db: D1Database,
	slot: TripSlot,
	orderId: number | null
): Promise<ScheduleClash[]> {
	if (null === slot.time) {
		return [];
	}
	const { results } = await db
		.prepare(
			`select id as orderId, json_extract(client_attributes, '$.name') as clientName from orders
			where status != 'CANCELLED' and id is not ?3 and (
				(delivery_date = ?1 and json_extract(delivery_attributes, '$.time') = ?2)
				or (pickup_date = ?1 and json_extract(pickup_attributes, '$.time') = ?2)
			) order by id`
		)
		.bind(slot.date, slot.time, orderId)
		.all<Omit<ScheduleClash, 'trip'>>();
	return results.map((clash) => ({ trip: slot.trip, ...clash }));
}

/** The form's banners: trips on a holiday and schedule clashes. They warn, and the order still saves. */
export async function getOrderWarnings(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<OrderWarnings> {
	requireRole(actor, TAKES_ORDERS);
	const trips = warningsSchema.parse(input);
	const slots: TripSlot[] = [
		{ trip: 'DELIVERY', date: trips.delivery_date, time: trips.delivery_time },
		{ trip: 'PICKUP', date: trips.pickup_date, time: trips.pickup_time }
	];
	const clashes = await Promise.all(slots.map((slot) => findClashes(db, slot, trips.order_id)));
	return { holidays: await findHolidayWarnings(db, slots), clashes: clashes.flat() };
}
