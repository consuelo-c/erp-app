// Pedidos: an order, its client's snapshot, its two trips and its lines. Created on an existing
// client, edited from DRAFT through DELIVERED, never deleted. Availability and the form's warnings
// only inform: nothing here blocks on them.

import { z } from 'zod';
import { addDays, getTodaysDate, getWeekStart } from '$lib/datetime';
import { normalizePhone } from '$lib/phone';
import {
	calculateOrderTotals,
	isEditableStatus,
	isLegalTransition,
	isOrderInflow,
	isPickupStatus,
	OPERATIONAL_STATUSES,
	ORDER_PAYMENT_CONCEPTS,
	type OrderTotals,
	type PricedLine
} from '$lib/orders';
import { ROLES, requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate, eventFieldsSchema } from '../audit';
import { describeOrderEdit, type OrderChange } from '../order-changes';
import { filterTimelineForActor } from '../timeline';
import {
	foldedSql,
	optional,
	recordLinkedMovement,
	type CashConcept,
	type PaymentMethod
} from './cash';
import { listProducts, type Product } from './products';
import {
	generateDocumentId,
	getContact,
	INVALID_PHONE,
	listTransporters,
	newClientStatements,
	searchClause,
	type NewClient,
	type Transporter
} from './contacts';
import { COMPANY_SETTINGS, readSettings, type CompanySettings } from './settings';

// The commercial side: whoever takes orders creates and edits them.
const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;

// Money out of an order, refunds included, is the manager's.
const PAYS_OUT = ['ADMIN', 'MANAGER'] as const;

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
export type OrderAttributes = z.infer<typeof orderAttributesSchema>;

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
			time: z.iso
				.time({ precision: -1, error: 'Escribe la hora como 2:30 p.m.' })
				.nullable()
				.default(null),
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
		// Null is «Cliente nuevo»: a contact made from the phone and the name typed.
		client_id: z.number('Escoge el cliente').int().positive('Escoge el cliente').nullable(),
		// The order's own snapshot of the name: it may say more than the contact does.
		client_name: z
			.string('Escribe el nombre del cliente')
			.trim()
			.min(1, 'Escribe el nombre del cliente'),
		client_phone: z.string().optional(),
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
		message: 'La entrega no puede ser después de la recogida',
		path: ['delivery_date']
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
	client_id: number | null; // null until «Cliente nuevo»'s contact exists, in the same batch
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

type OrderRow = Omit<Columns, 'client_id'> & {
	id: number;
	client_id: number;
	status: OrderStatus;
	has_incident: number;
};

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

type ResolvedClient = { snapshot: ClientAttributes; newClient: NewClient | null };

// «Cliente nuevo» is made from the phone typed, normalized, and the name typed.
function newClient(order: OrderInput): ResolvedClient | Refusal {
	const phone = normalizePhone(order.client_phone ?? '');
	if (null === phone) {
		return refusal('client_phone', INVALID_PHONE);
	}
	const client = { phone, fullName: order.client_name, documentId: generateDocumentId() };
	return { snapshot: { name: order.client_name, phone }, newClient: client };
}

// The order keeps the name typed and the phone it was taken with: renaming the contact, or
// changing its phone, later changes nothing. No existing contact is ever written from here.
async function resolveClient(
	db: D1Database,
	order: OrderInput,
	current: Order | null
): Promise<ResolvedClient | Refusal> {
	if (null === order.client_id) {
		return newClient(order);
	}
	if (order.client_id === current?.clientId) {
		return { snapshot: { ...current.client, name: order.client_name }, newClient: null };
	}
	const contact = await db
		.prepare('select phone from contacts where id = ?')
		.bind(order.client_id)
		.first<{ phone: string }>();
	if (null === contact) {
		return refusal('client_id', 'Ese cliente no existe');
	}
	return { snapshot: { name: order.client_name, phone: contact.phone }, newClient: null };
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

type ResolvedOrder = { columns: Columns; newClient: NewClient | null };

/** The columns to store for `order`, or why it can't be saved. `current` is the order being edited. */
async function resolveColumns(
	db: D1Database,
	order: OrderInput,
	current: Order | null
): Promise<ResolvedOrder | Refusal> {
	const client = await resolveClient(db, order, current);
	if ('ok' in client) {
		return client;
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
	const resolved = { client: client.snapshot, ...trips, items, parentOrderId };
	return { columns: toColumns(order, resolved), newClient: client.newClient };
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

// «Cliente nuevo»'s contact goes first in the order's batch, and the order finds its id by the
// new document: never `last_insert_rowid()`, which its own event already relies on.
function clientWrite(db: D1Database, actor: Actor, { columns, newClient }: ResolvedOrder) {
	const { client_id: clientId, ...values } = columns;
	if (null === newClient) {
		return { values: { ...values, client_id: clientId }, computed: {}, clientStatements: [] };
	}
	const computed = {
		client_id: {
			sql: 'select id from contacts where document_id = ?',
			params: [newClient.documentId]
		}
	};
	return { values, computed, clientStatements: newClientStatements(db, actor, newClient) };
}

async function insertOrder(
	db: D1Database,
	actor: Actor,
	{ resolved, status }: { resolved: ResolvedOrder; status: OrderStatus }
): Promise<SaveResult> {
	const { values, computed, clientStatements } = clientWrite(db, actor, resolved);
	// The public lookup's key: it stays out of events, which every role's timeline reads.
	const statements = auditedInsert(db, {
		table: 'orders',
		entityType: 'ORDER',
		actor,
		values: { ...values, status },
		unlogged: { public_token: crypto.randomUUID() },
		computed
	});
	const results = await db.batch([...clientStatements, ...statements]);
	return { ok: true, id: results[clientStatements.length].meta.last_row_id };
}

/** A new order, on a client picked or a new one, born a draft: confirming is a step of its own. */
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
	const resolved = await resolveColumns(db, parsed.data, null);
	return 'ok' in resolved ? resolved : insertOrder(db, actor, { resolved, status: 'DRAFT' });
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
	{ row, resolved }: { row: OrderRow; resolved: ResolvedOrder }
): Promise<SaveResult> {
	const { values, computed, clientStatements } = clientWrite(db, actor, resolved);
	const statements = auditedUpdate(db, {
		table: 'orders',
		entityType: 'ORDER',
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
	if (!isEditableStatus(row.status)) {
		return NOT_EDITABLE;
	}
	const resolved = await resolveColumns(db, parsed.data, toOrder(row));
	return 'ok' in resolved ? resolved : applyEdit(db, actor, { row, resolved });
}

const extensionInputSchema = z.object({ parent_order_id: z.coerce.number().int().positive() });

const NOT_EXTENDABLE: Refusal = {
	ok: false,
	message: 'Solo un pedido entregado se puede extender',
	errors: {}
};

// Only the original's products, each up to the quantity the client has.
function exceedsOriginal(lines: LineInput[], original: Order): Refusal | null {
	const held = new Map(original.items.map((item) => [item.product_id, item.qty]));
	for (const [index, line] of lines.entries()) {
		const qty = held.get(line.product_id);
		if (undefined === qty) {
			return refusal(`order_items.${index}.product_id`, `No está en el pedido #${original.id}`);
		}
		if (line.qty > qty) {
			return refusal(
				`order_items.${index}.qty`,
				`Máximo ${qty}, lo que tiene el pedido #${original.id}`
			);
		}
	}
	return null;
}

async function findExtendable(db: D1Database, input: unknown): Promise<Order | Refusal> {
	const parsed = extensionInputSchema.safeParse(input);
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	const row = await findRow(db, parsed.data.parent_order_id);
	if (null === row) {
		return NOT_FOUND;
	}
	return 'DELIVERED' === row.status ? toOrder(row) : NOT_EXTENDABLE;
}

/**
 * Some of a delivered order's products kept for more days: a new order, born DELIVERED, since
 * they're already at the client's. The original isn't touched. Its client, trips and lines are
 * copied, each line keeping its name and prices; the dates, rental days and transport are its own.
 */
export async function createExtension(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, TAKES_ORDERS);
	const original = await findExtendable(db, input);
	if ('ok' in original) {
		return original;
	}
	// The day after the original's pickup, whatever was sent: availability counts both ends of
	// each range, so starting on the pickup day would count it twice.
	const deliveryDate = addDays(original.pickupDate, 1);
	const parsed = orderInputSchema.safeParse({ ...(input as object), delivery_date: deliveryDate });
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	const exceeded = exceedsOriginal(parsed.data.order_items, original);
	if (null !== exceeded) {
		return exceeded;
	}
	// Resolved against the original, so its snapshots and its lines' frozen names and prices carry over.
	const resolved = await resolveColumns(db, parsed.data, {
		...original,
		parentOrderId: original.id
	});
	return 'ok' in resolved ? resolved : insertOrder(db, actor, { resolved, status: 'DELIVERED' });
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

// No list is the whole catalog: the order form shows each search result's availability too.
const availabilitySchema = tripDatesSchema.safeExtend({
	product_ids: z.array(z.coerce.number().int().positive()).nullable().default(null)
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
	where ?5 is null or products.id in (select value from json_each(?5))
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
	return queryAvailability(db, availabilitySchema.parse(input));
}

type AvailabilityRange = z.output<typeof availabilitySchema>;

async function queryAvailability(
	db: D1Database,
	range: AvailabilityRange
): Promise<Availability[]> {
	const { results } = await db
		.prepare(AVAILABILITY_SQL)
		.bind(
			range.delivery_date,
			range.pickup_date,
			JSON.stringify(RESERVING_STATUSES),
			range.order_id,
			null === range.product_ids ? null : JSON.stringify(range.product_ids)
		)
		.all<Availability>();
	return results;
}

export type TripKind = 'DELIVERY' | 'PICKUP';

/** A trip on a holiday in `PAYROLL_HOLIDAYS`: the truck goes out or comes back that day. */
export type HolidayWarning = { trip: TripKind; date: string; label: string };

/** Another order whose delivery or pickup (`theirTrip`) falls on this trip's date and time. */
export type ScheduleClash = {
	trip: TripKind;
	theirTrip: TripKind;
	orderId: number;
	clientName: string;
	date: string;
	time: string;
};

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
			`select id as orderId, json_extract(client_attributes, '$.name') as clientName,
			case when delivery_date = ?1 and json_extract(delivery_attributes, '$.time') = ?2
				then 'DELIVERY' else 'PICKUP' end as theirTrip
			from orders where status != 'CANCELLED' and id is not ?3 and (
				(delivery_date = ?1 and json_extract(delivery_attributes, '$.time') = ?2)
				or (pickup_date = ?1 and json_extract(pickup_attributes, '$.time') = ?2)
			) order by id`
		)
		.bind(slot.date, slot.time, orderId)
		.all<Pick<ScheduleClash, 'orderId' | 'clientName' | 'theirTrip'>>();
	const { trip, date, time } = slot;
	return results.map((clash) => ({ trip, ...clash, date, time }));
}

/** The form's banners: trips on a holiday and schedule clashes. They warn, and the order still saves. */
export async function getOrderWarnings(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<OrderWarnings> {
	requireRole(actor, TAKES_ORDERS);
	return findWarnings(db, warningsSchema.parse(input));
}

type Trips = z.output<typeof warningsSchema>;

async function findWarnings(db: D1Database, trips: Trips): Promise<OrderWarnings> {
	const slots: TripSlot[] = [
		{ trip: 'DELIVERY', date: trips.delivery_date, time: trips.delivery_time },
		{ trip: 'PICKUP', date: trips.pickup_date, time: trips.pickup_time }
	];
	const clashes = await Promise.all(slots.map((slot) => findClashes(db, slot, trips.order_id)));
	return { holidays: await findHolidayWarnings(db, slots), clashes: clashes.flat() };
}

/** What the order form shows for its trips as they're typed: the whole catalog's availability and the warnings. */
export type OrderSchedule = { availability: Availability[]; warnings: OrderWarnings };

/**
 * The form's live check, as its dates and times change. Dates still half-typed, or a delivery
 * after the pickup, check nothing: null, not an error, since the form will ask again.
 */
export async function checkOrderSchedule(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<OrderSchedule | null> {
	requireRole(actor, TAKES_ORDERS);
	const parsed = warningsSchema.safeParse(input);
	if (!parsed.success) {
		return null;
	}
	const [availability, warnings] = await Promise.all([
		queryAvailability(db, { ...parsed.data, product_ids: null }),
		findWarnings(db, parsed.data)
	]);
	return { availability, warnings };
}

const transitionSchema = z.object({ id: z.coerce.number().int().positive() });

const cancellationSchema = transitionSchema.extend({
	reason: z.string('Escribe el motivo').trim().min(1, 'Escribe el motivo de la cancelación')
});

const advanceSchema = transitionSchema.extend({
	status: z.enum(OPERATIONAL_STATUSES, 'Escoge el estado'),
	// The direction's note, replaced whole; blank clears it. Absent leaves it as it is.
	notes: z.string().trim().optional()
});

const ILLEGAL_TRANSITION: Refusal = {
	ok: false,
	message: 'El pedido no puede pasar a ese estado desde el que tiene',
	errors: {}
};

type Transition = {
	id: number;
	to: OrderStatus;
	action: string;
	reason?: string;
	notes?: string;
};

// Logged key by key, so the note shows in the event as `delivery_attributes.notes`.
const TRIP_COLUMNS = ['delivery_attributes', 'pickup_attributes'] as const;

// The driver's note goes to the trip the transition belongs to.
function noteChange(row: OrderRow, to: OrderStatus, notes: string): Partial<OrderRow> {
	const { delivery, pickup } = toOrder(row);
	const note = { notes: notes || null };
	return isPickupStatus(to)
		? { pickup_attributes: JSON.stringify(pickupAttributesSchema.parse({ ...pickup, ...note })) }
		: {
				delivery_attributes: JSON.stringify(
					deliveryAttributesSchema.parse({ ...delivery, ...note })
				)
			};
}

function isLegalFrom(row: OrderRow, to: OrderStatus): boolean {
	const { delivery, pickup } = toOrder(row);
	const methods = { deliveryMethod: delivery.method, returnMethod: pickup.method };
	return isLegalTransition({ from: row.status, to, ...methods });
}

// Every status change goes through here: the one rule decides, whoever asks.
async function applyTransition(
	db: D1Database,
	actor: Actor,
	transition: Transition
): Promise<SaveResult> {
	const row = await findRow(db, transition.id);
	if (null === row) {
		return NOT_FOUND;
	}
	if (!isLegalFrom(row, transition.to)) {
		return ILLEGAL_TRANSITION;
	}
	const { id, to, notes, ...event } = transition;
	const note = undefined === notes ? {} : noteChange(row, to, notes);
	const changes = { status: to, ...note };
	const write = { table: 'orders', entityType: 'ORDER', actor, id, current: row, changes };
	await db.batch(auditedUpdate(db, { ...write, ...event, jsonColumns: TRIP_COLUMNS }));
	return { ok: true, id };
}

/** A draft becomes a commitment. No advance is required: the salesperson confirms with $0 paid. */
export async function confirmOrder(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, TAKES_ORDERS);
	const parsed = transitionSchema.safeParse(input);
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	const transition = { id: parsed.data.id, to: 'CONFIRMED' as const, action: 'STATUS_CHANGED' };
	return applyTransition(db, actor, transition);
}

/**
 * Up to the delivery, with a required reason kept in the event. It releases the inventory on its
 * own: availability only counts the reserving states. Payments already made are refunded by hand.
 */
export async function cancelOrder(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, TAKES_ORDERS);
	const parsed = cancellationSchema.safeParse(input);
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	const { id, reason } = parsed.data;
	return applyTransition(db, actor, { id, to: 'CANCELLED', action: 'CANCELLED', reason });
}

/**
 * A cancelled order back to a draft, often for another date, instead of taking it again. It holds
 * nothing until it's confirmed again; its payments and refunds stay as they were recorded.
 */
export async function reopenOrder(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, TAKES_ORDERS);
	const parsed = transitionSchema.safeParse(input);
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	return applyTransition(db, actor, { id: parsed.data.id, to: 'DRAFT', action: 'STATUS_CHANGED' });
}

/**
 * Picked, out for delivery, delivered, out for pickup, completed: open to every role. With five
 * employees, locking them to one would stop the warehouse the day its person is out.
 */
export async function advanceOrder(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, ROLES);
	const parsed = advanceSchema.safeParse(input);
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	const { id, status, notes } = parsed.data;
	return applyTransition(db, actor, { id, to: status, action: 'STATUS_CHANGED', notes });
}

/** A line the order asks more of than its range has left. */
export type Shortage = { productId: number; name: string; short: number };

/** What the confirmation shows. Neither blocks: the order confirms overbooked and with $0 paid. */
export type ConfirmationPreview = { shortages: Shortage[]; suggestedAdvance: number };

function findShortages(items: OrderItem[], availability: Availability[]): Shortage[] {
	const available = new Map(availability.map((each) => [each.productId, each.available]));
	return items
		.map((item) => ({
			productId: item.product_id,
			name: item.name,
			short: item.qty - (available.get(item.product_id) ?? 0)
		}))
		.filter((shortage) => shortage.short > 0);
}

/** Re-checks availability for the confirmation, and works out the suggested advance as a reference. */
export async function previewConfirmation(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<ConfirmationPreview | null> {
	requireRole(actor, TAKES_ORDERS);
	const row = await findRow(db, transitionSchema.parse(input).id);
	if (null === row) {
		return null;
	}
	const order = toOrder(row);
	const availability = await queryAvailability(db, {
		order_id: order.id,
		delivery_date: order.deliveryDate,
		pickup_date: order.pickupDate,
		product_ids: order.items.map((item) => item.product_id)
	});
	const { ORDERS_SUGGESTED_ADVANCE_PCT: percentage } = await readSettings(db, [
		'ORDERS_SUGGESTED_ADVANCE_PCT'
	]);
	const suggestedAdvance = Math.round((order.orderTotal * percentage) / 100);
	return { shortages: findShortages(order.items, availability), suggestedAdvance };
}

/** A page of the order list: it never loads the whole table. */
export const ORDERS_PAGE_SIZE = 20;

/** Which deliveries the list shows: this week's unless asked. Weeks run Monday to Sunday. */
export const DELIVERY_PERIODS = ['TODAY', 'THIS_WEEK', 'NEXT_WEEK', 'ALL'] as const;

export type DeliveryPeriod = (typeof DELIVERY_PERIODS)[number];

// The text as typed, its runs of spaces collapsed: «ivan     betancur» is two words.
const searchTextSchema = z
	.string()
	.transform((typed) => typed.trim().replace(/\s+/g, ' '))
	.pipe(z.string().min(1));

// `page` past the last one shows the last: a typed URL is tolerated like any other filter.
const listSchema = z.object({
	text: optional(searchTextSchema),
	delivery: z.enum(DELIVERY_PERIODS).catch('THIS_WEEK'),
	from: optional(z.iso.date()),
	to: optional(z.iso.date()),
	status: optional(z.enum(ORDER_STATUSES)),
	hasIncident: optional(z.literal('1').transform(() => true)),
	page: z.coerce.number().int().min(1).catch(1)
});

export type OrderFilters = z.output<typeof listSchema>;

export type OrderSummary = {
	id: number;
	clientName: string;
	eventDate: string;
	status: OrderStatus;
	hasIncident: boolean;
	deliveryMethod: DeliveryMethod;
	orderTotal: number;
	/** The total less what was paid: negative is the client's credit. */
	balanceDue: number;
};

/** The filters come back parsed, `page` clamped: what the screen shows as chosen is what was applied. */
export type OrderPage = {
	orders: OrderSummary[];
	total: number;
	pageCount: number;
	filters: OrderFilters;
};

type Clause = { sql: string; params: (string | number)[] };

const FOLDED_NAME_SQL = foldedSql("json_extract(client_attributes, '$.name')");

// Bogotá's today, so the week turns at its midnight.
function deliveryClause(period: DeliveryPeriod): Clause | null {
	const today = getTodaysDate();
	const monday = getWeekStart(today);
	const ranges = {
		TODAY: [today, today],
		THIS_WEEK: [monday, addDays(monday, 6)],
		NEXT_WEEK: [addDays(monday, 7), addDays(monday, 13)],
		ALL: null
	};
	const range = ranges[period];
	return null === range ? null : { sql: 'delivery_date between ? and ?', params: range };
}

// Each filter in SQL, over the order's own snapshot: never the contact, whose name or phone may
// have changed since.
function listClauses(filters: OrderFilters): Clause[] {
	const candidates: [unknown, Clause][] = [
		[filters.from, { sql: 'event_date >= ?', params: [filters.from ?? ''] }],
		[filters.to, { sql: 'event_date <= ?', params: [filters.to ?? ''] }],
		[filters.status, { sql: 'status = ?', params: [filters.status ?? ''] }],
		[filters.hasIncident, { sql: 'has_incident = 1', params: [] }]
	];
	const set = candidates.filter(([value]) => undefined !== value).map(([, clause]) => clause);
	const search =
		undefined === filters.text
			? null
			: searchClause(filters.text, FOLDED_NAME_SQL, "json_extract(client_attributes, '$.phone')");
	return [...set, deliveryClause(filters.delivery), search].filter((clause) => null !== clause);
}

/** What the client still owes: the total less its installments and their refunds. */
export const BALANCE_DUE_SQL = `order_total - coalesce((select sum(amount) from cash_movements
	where entity_type = 'ORDER' and entity_id = orders.id
	and concept in ('INSTALLMENT', 'INSTALLMENT_REFUND')), 0)`;

type SummaryRow = {
	id: number;
	client_name: string;
	event_date: string;
	status: OrderStatus;
	has_incident: number;
	delivery_method: DeliveryMethod;
	order_total: number;
	balance_due: number;
};

function toSummary(row: SummaryRow): OrderSummary {
	return {
		id: row.id,
		clientName: row.client_name,
		eventDate: row.event_date,
		status: row.status,
		hasIncident: 1 === row.has_incident,
		deliveryMethod: row.delivery_method,
		orderTotal: row.order_total,
		balanceDue: row.balance_due
	};
}

/** One page of orders, latest event first, narrowed by every filter at once. */
export async function listOrders(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<OrderPage> {
	requireRole(actor, TAKES_ORDERS);
	const parsed = listSchema.parse(input ?? {});
	const clauses = listClauses(parsed);
	const where = clauses.map((clause) => `(${clause.sql})`).join(' and ') || '1';
	const params = clauses.flatMap((clause) => clause.params);
	const count = await db
		.prepare(`select count(*) as total from orders where ${where}`)
		.bind(...params)
		.first<{ total: number }>();
	const total = count?.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
	const filters = { ...parsed, page: Math.min(parsed.page, pageCount) };
	const { results } = await db
		.prepare(
			`select id, json_extract(client_attributes, '$.name') as client_name, event_date, status,
			has_incident, json_extract(delivery_attributes, '$.method') as delivery_method,
			order_total, ${BALANCE_DUE_SQL} as balance_due
			from orders where ${where} order by event_date desc, id desc limit ? offset ?`
		)
		.bind(...params, ORDERS_PAGE_SIZE, (filters.page - 1) * ORDERS_PAGE_SIZE)
		.all<SummaryRow>();
	return { orders: results.map(toSummary), total, pageCount, filters };
}

/** What the client left as a guarantee and hasn't been given back: held, never income. */
const DEPOSIT_HELD_SQL = `coalesce((select sum(amount) from cash_movements
	where entity_type = 'ORDER' and entity_id = orders.id
	and concept in ('SECURITY_DEPOSIT', 'DEPOSIT_REFUND')), 0)`;

/** One of the order's movements, as its detail lists it. */
export type OrderPayment = {
	id: number;
	movementDate: string;
	concept: CashConcept;
	amount: number;
	method: PaymentMethod;
	/** «¿Cuál medio de pago?» for `OTHER`. */
	otherMethod: string | null;
	/** The client's name, or the carrier's for a carrier payment, as it was recorded. */
	payee: string | null;
	receiptNumber: number;
};

/** Who cancelled the order, when, and why: its CANCELLED event. */
export type Cancellation = { cancelledAt: number; cancelledBy: string; reason: string };

/**
 * The order with its money: «Pagado» is what its installments and refunds add up to, the deposit
 * held what its deposits and their refunds do. A carrier payment touches neither: it's the
 * company's money out, not the client's.
 */
export type OrderDetail = Order & {
	paid: number;
	balanceDue: number;
	depositHeld: number;
	payments: OrderPayment[];
	cancellation: Cancellation | null;
	extensions: Extension[];
	/** When it was edited after the warehouse staged it (epoch seconds), or null. */
	modifiedAfterStagingAt: number | null;
};

// Staged from PICKED on. A cancelled order reopened and confirmed again holds nothing staged until
// it's picked again, which its status already says.
const STAGED = ['PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'OUT_FOR_PICKUP', 'COMPLETED'] as const;

// ponytail: events has no (entity_type, entity_id) index, so each order scans it; add one if the
// list slows down.
/**
 * The only rule for «modified after staging», over `orders` in the caller's query: the time of the
 * order's latest `EDITED` event when it's later than its latest move to `PICKED`, else null. Never
 * `updated_at`: every transition and the driver's notes move it too, and neither is an `EDITED`.
 * An extension is born `DELIVERED`, with no `PICKED`: never. Event ids order it, not `created_at`,
 * so an edit in the same second as the pick still counts.
 */
export const MODIFIED_AFTER_STAGING_AT = `(select edit.created_at from events edit
	where orders.status in (${STAGED.map((status) => `'${status}'`).join(', ')})
	and edit.entity_type = 'ORDER' and edit.entity_id = orders.id and edit.action = 'EDITED'
	and edit.id > (select max(picked.id) from events picked
		where picked.entity_type = 'ORDER' and picked.entity_id = orders.id
		and picked.action = 'STATUS_CHANGED' and json_extract(picked.after, '$.status') = 'PICKED')
	order by edit.id desc limit 1)`;

async function findModifiedAfterStagingAt(db: D1Database, orderId: number): Promise<number | null> {
	const row = await db
		.prepare(`select ${MODIFIED_AFTER_STAGING_AT} as at from orders where id = ?`)
		.bind(orderId)
		.first<{ at: number | null }>();
	return row?.at ?? null;
}

/** An order made to keep some of this one's products longer. */
export type Extension = {
	id: number;
	status: OrderStatus;
	deliveryDate: string;
	pickupDate: string;
};

// No index: extensions are rare.
async function findExtensions(db: D1Database, orderId: number): Promise<Extension[]> {
	const { results } = await db
		.prepare(
			`select id, status, delivery_date as deliveryDate, pickup_date as pickupDate from orders
			where json_extract(attributes, '$.parent_order_id') = ? order by id`
		)
		.bind(orderId)
		.all<Extension>();
	return results;
}

type PaymentRow = {
	id: number;
	movement_date: string;
	concept: CashConcept;
	amount: number;
	payment_method: PaymentMethod;
	other_method: string | null;
	payee: string | null;
	receipt_number: number;
};

function toPayment(row: PaymentRow): OrderPayment {
	return {
		id: row.id,
		movementDate: row.movement_date,
		concept: row.concept,
		amount: row.amount,
		method: row.payment_method,
		otherMethod: row.other_method,
		payee: row.payee,
		receiptNumber: row.receipt_number
	};
}

async function findPayments(db: D1Database, orderId: number): Promise<OrderPayment[]> {
	const { results } = await db
		.prepare(
			`select id, movement_date, concept, amount, payment_method,
			json_extract(attributes, '$.other_method') as other_method, payee, receipt_number
			from cash_movements where entity_type = 'ORDER' and entity_id = ?
			order by movement_date, id`
		)
		.bind(orderId)
		.all<PaymentRow>();
	return results.map(toPayment);
}

// Only while it's cancelled: a reopened order's cancellation stays in its timeline.
async function findCancellation(db: D1Database, orderId: number): Promise<Cancellation | null> {
	return db
		.prepare(
			`select created_at as cancelledAt, actor_username as cancelledBy, reason from events
			where entity_type = 'ORDER' and entity_id = ?1 and action = 'CANCELLED'
			and 'CANCELLED' = (select status from orders where id = ?1)
			order by id desc limit 1`
		)
		.bind(orderId)
		.first<Cancellation>();
}

async function findBalances(
	db: D1Database,
	orderId: number
): Promise<{ balanceDue: number; depositHeld: number }> {
	const balances = await db
		.prepare(
			`select ${BALANCE_DUE_SQL} as balanceDue, ${DEPOSIT_HELD_SQL} as depositHeld
			from orders where id = ?`
		)
		.bind(orderId)
		.first<{ balanceDue: number; depositHeld: number }>();
	return balances ?? { balanceDue: 0, depositHeld: 0 };
}

const orderIdSchema = z.coerce.number().int().positive();

/**
 * The order's detail screen, and Despachos' operational detail: the order, its payments, its
 * balances, and its cancellation if any. Open to every role: prices aren't hidden from anyone.
 */
export async function getOrderDetail(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<OrderDetail | null> {
	requireRole(actor, ROLES);
	const parsedId = orderIdSchema.safeParse(id);
	if (!parsedId.success) {
		return null;
	}
	const orderId = parsedId.data;
	const [row, payments, cancellation, balances, extensions, modifiedAfterStagingAt] =
		await Promise.all([
			findRow(db, orderId),
			findPayments(db, orderId),
			findCancellation(db, orderId),
			findBalances(db, orderId),
			findExtensions(db, orderId),
			findModifiedAfterStagingAt(db, orderId)
		]);
	if (null === row) {
		return null;
	}
	const order = toOrder(row);
	const paid = order.orderTotal - balances.balanceDue;
	const linked = { payments, cancellation, extensions, modifiedAfterStagingAt };
	return { ...order, ...balances, paid, ...linked };
}

/** A trip as the printout carries it: the client signs that paper and never sees the carrier. */
type PrintedTrip<Trip extends DeliveryAttributes | PickupAttributes> = Pick<
	Trip,
	'method' | 'time' | 'address_1' | 'address_2'
>;

export type OrderPrintout = {
	order: Omit<OrderDetail, 'delivery' | 'pickup'> & {
		delivery: PrintedTrip<DeliveryAttributes>;
		pickup: PrintedTrip<PickupAttributes>;
	};
	company: CompanySettings;
};

function toPrintedTrip<Trip extends DeliveryAttributes | PickupAttributes>(
	trip: Trip
): PrintedTrip<Trip> {
	return {
		method: trip.method,
		time: trip.time,
		address_1: trip.address_1,
		address_2: trip.address_2
	};
}

/** The order's half-letter sheet, the same for sales, the warehouse and the driver. */
export async function getOrderPrintout(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<OrderPrintout | null> {
	requireRole(actor, ROLES);
	const [order, company] = await Promise.all([
		getOrderDetail(db, id, actor),
		readSettings(db, COMPANY_SETTINGS)
	]);
	if (null === order) {
		return null;
	}
	const delivery = toPrintedTrip(order.delivery);
	const pickup = toPrintedTrip(order.pickup);
	return { order: { ...order, delivery, pickup }, company };
}

const paymentInputSchema = z.object({
	order_id: orderIdSchema,
	concept: z.enum(ORDER_PAYMENT_CONCEPTS, 'Escoge el concepto'),
	trip: z.enum(['DELIVERY', 'PICKUP']).optional(),
	payee: blankable
});

type PaymentInput = z.output<typeof paymentInputSchema>;

type TripCarrier = { trip: TripKind; carrier: Carrier };

/** The carriers an order pays, by trip: one when both trips go with the same one. */
function carriersOf(order: Order): TripCarrier[] {
	const trips: [TripKind, Carrier | null][] = [
		['DELIVERY', order.delivery.carrier],
		['PICKUP', order.pickup.carrier]
	];
	const carriers = trips.flatMap(([trip, carrier]) =>
		null === carrier ? [] : [{ trip, carrier }]
	);
	return carriers.filter(
		(entry, index) => index === carriers.findIndex((other) => other.carrier.id === entry.carrier.id)
	);
}

// The client's name, copied; a carrier payment's is the carrier's, editable. With two carriers
// the payment says which one.
function payeeOf(order: Order, payment: PaymentInput): string | Refusal {
	if ('CARRIER_PAYMENT' !== payment.concept) {
		return order.client.name;
	}
	const carriers = carriersOf(order);
	if (0 === carriers.length) {
		return { ok: false, message: 'Este pedido no tiene transportador.', errors: {} };
	}
	const chosen =
		1 === carriers.length ? carriers[0] : carriers.find((entry) => entry.trip === payment.trip);
	if (undefined === chosen) {
		return refusal('trip', 'Escoge a cuál transportador');
	}
	return payment.payee ?? chosen.carrier.name;
}

/**
 * Records one of the order's movements, in any state, cancelled included: nothing blocks on the
 * balance or the deposit. Valor is typed positive; the concept gives the sign.
 */
export async function recordOrderPayment(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, TAKES_ORDERS);
	const parsed = paymentInputSchema.safeParse(input);
	if (!parsed.success) {
		return invalidOrder(parsed.error);
	}
	if (!isOrderInflow(parsed.data.concept)) {
		requireRole(actor, PAYS_OUT);
	}
	const row = await findRow(db, parsed.data.order_id);
	if (null === row) {
		return { ok: false, message: 'Ese pedido no existe.', errors: {} };
	}
	const order = toOrder(row);
	const payee = payeeOf(order, parsed.data);
	if ('string' !== typeof payee) {
		return payee;
	}
	const { concept } = parsed.data;
	const link = { concept, entityType: 'ORDER', entityId: order.id, payee };
	return recordLinkedMovement(db, { form: input, ...link }, actor);
}

/** A carrier the order can pay, with the account its contact keeps. */
export type PayableCarrier = { trip: TripKind; name: string; bankAccount: string | null };

/** What the payment entry pre-fills Cuenta de destino and «Pagado a» from: the contacts' accounts. */
export type PaymentOptions = { clientBankAccount: string | null; carriers: PayableCarrier[] };

export async function getPaymentOptions(
	db: D1Database,
	order: Order,
	actor: Actor | null
): Promise<PaymentOptions> {
	requireRole(actor, TAKES_ORDERS);
	const carriers = carriersOf(order);
	const [client, ...contacts] = await Promise.all(
		[order.clientId, ...carriers.map((entry) => entry.carrier.id)].map((id) =>
			getContact(db, id, actor)
		)
	);
	return {
		clientBankAccount: client?.bankAccount ?? null,
		carriers: carriers.map(({ trip, carrier }, index) => ({
			trip,
			name: carrier.name,
			bankAccount: contacts[index]?.bankAccount ?? null
		}))
	};
}

/** A product the order form can add: active, with its catalog price and stock. */
export type CatalogProduct = Pick<
	Product,
	'id' | 'name' | 'category' | 'variantGroup' | 'variantName' | 'rentalPrice' | 'totalQuantity'
>;

/** Everything the order form picks from, read once when it opens. */
export type OrderFormOptions = {
	products: CatalogProduct[];
	transporters: Transporter[];
	/** Where a client picks up or brings back: the warehouse, its address and the company's name. */
	company: { name: string; address: string };
};

export async function getOrderFormOptions(
	db: D1Database,
	actor: Actor | null
): Promise<OrderFormOptions> {
	requireRole(actor, TAKES_ORDERS);
	const [catalog, transporters, settings] = await Promise.all([
		listProducts(db, {}, actor),
		listTransporters(db, actor),
		readSettings(db, ['COMPANY_NAME', 'COMPANY_ADDRESS'])
	]);
	// An inactive product can't be added; a line that holds one keeps it, frozen.
	const products = catalog.products
		.filter((product) => product.isActive)
		.map(({ id, name, category, variantGroup, variantName, rentalPrice, totalQuantity }) => ({
			id,
			name,
			category,
			variantGroup,
			variantName,
			rentalPrice,
			totalQuantity
		}));
	const company = { name: settings.COMPANY_NAME, address: settings.COMPANY_ADDRESS };
	return { products, transporters, company };
}

/** One row of the order's timeline. The edit's fields stay in `events` until it's expanded. */
export type TimelineEntry = {
	id: number;
	action: 'CREATED' | 'EDITED' | 'STATUS_CHANGED' | 'CANCELLED';
	/** The status a `STATUS_CHANGED` moved to. */
	status: OrderStatus | null;
	/** A cancellation's. */
	reason: string | null;
	actorUsername: string;
	createdAt: number;
};

/**
 * The order's events, newest first, as `actor` may see them: `WAREHOUSE` and `DRIVER` get only its
 * status changes, which Phase 10's operational detail shows them. Null when there's no such order.
 */
export async function getOrderTimeline(
	db: D1Database,
	id: unknown,
	actor: Actor | null
): Promise<TimelineEntry[] | null> {
	requireRole(actor, ROLES);
	const parsedId = orderIdSchema.safeParse(id);
	if (!parsedId.success || null === (await findRow(db, parsedId.data))) {
		return null;
	}
	const { results } = await db
		.prepare(
			`select id, action, json_extract(after, '$.status') as status, reason,
			actor_username as actorUsername, created_at as createdAt from events
			where entity_type = 'ORDER' and entity_id = ? order by created_at desc, id desc`
		)
		.bind(parsedId.data)
		.all<TimelineEntry>();
	return filterTimelineForActor(results, actor);
}

// What an edit logs, read back through each column's schema. The client shows as its name, and the
// totals the lines and the discount work out aren't changes of their own: z.object drops them.
function jsonColumn<T extends z.ZodType>(schema: T) {
	return z
		.string()
		.transform((json): unknown => JSON.parse(json))
		.pipe(schema)
		.optional();
}

const editedFieldsSchema = z.object({
	event_date: z.iso.date().optional(),
	delivery_date: z.iso.date().optional(),
	pickup_date: z.iso.date().optional(),
	rental_days: z.number().int().optional(),
	discount: pesosSchema.optional(),
	transport_cost: pesosSchema.optional(),
	deposit_amount: pesosSchema.optional(),
	client_attributes: jsonColumn(clientAttributesSchema),
	delivery_attributes: jsonColumn(deliveryAttributesSchema),
	pickup_attributes: jsonColumn(pickupAttributesSchema),
	order_items: jsonColumn(orderItemsSchema),
	attributes: jsonColumn(orderAttributesSchema)
});

export type EditedFields = z.infer<typeof editedFieldsSchema>;

function toEditedFields(json: string | null): EditedFields {
	return editedFieldsSchema.parse(eventFieldsSchema.parse(JSON.parse(json ?? '{}')));
}

const changeInputSchema = z.object({ order: orderIdSchema, event: orderIdSchema });

type EditRow = { action: string; before: string | null; after: string | null };

/**
 * One edit's diff, fetched when its timeline row opens. Null for an event that isn't an edit of
 * that order, or one `actor` doesn't see on its timeline.
 */
export async function getOrderChange(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<OrderChange[] | null> {
	requireRole(actor, ROLES);
	const parsed = changeInputSchema.safeParse(input);
	if (!parsed.success) {
		return null;
	}
	const row = await db
		.prepare(
			`select action, before, after from events
			where id = ? and entity_type = 'ORDER' and entity_id = ?`
		)
		.bind(parsed.data.event, parsed.data.order)
		.first<EditRow>();
	if (
		null === row ||
		'EDITED' !== row.action ||
		0 === filterTimelineForActor([row], actor).length
	) {
		return null;
	}
	return describeOrderEdit(toEditedFields(row.before), toEditedFields(row.after));
}
