// Despachos: one day's deliveries and pickups, whoever moves them, for the driver and the warehouse.

import { z } from 'zod';
import { addDays, getTodaysDate } from '$lib/datetime';
import { ROLES, requireRole, type Actor } from '../actor';
import {
	clientAttributesSchema,
	deliveryAttributesSchema,
	MODIFIED_AFTER_STAGING_AT,
	ORDER_STATUSES,
	pickupAttributesSchema,
	type Carrier,
	type DeliveryAttributes,
	type DeliveryMethod,
	type OrderStatus,
	type PickupAttributes,
	type ReturnMethod
} from './orders';

// A day shows every trip dated on it, whatever its state, but a draft's or a cancelled one's.
const ACTIVE = ORDER_STATUSES.filter((status) => 'DRAFT' !== status && 'CANCELLED' !== status);

// Today also shows what's still pending from the days before: a delivery until it's delivered, a
// pickup until it's back.
const PENDING = {
	delivery: ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY'],
	pickup: ['DELIVERED', 'OUT_FOR_PICKUP']
} as const satisfies Record<Direction, readonly OrderStatus[]>;

// A trip 5 or more days late is no longer the day's work: Pedidos still has it.
const MAX_LATE_DAYS = 4;

type TripFields = {
	time: string | null;
	address1: string;
	address2: string | null;
	carrier: Carrier | null;
};

/** One row of the list: an order's delivery or its pickup, never both. */
export type DispatchRow = TripFields & {
	id: number;
	status: OrderStatus;
	hasIncident: boolean;
	modifiedAfterStaging: boolean;
	clientName: string;
	date: string;
	isLate: boolean;
	/** A pickup's extensions: the products some of them keep go on in those orders. */
	extensionIds: number[];
} & (
		| { direction: 'delivery'; method: DeliveryMethod }
		| { direction: 'pickup'; method: ReturnMethod }
	);

/** The rows of `date`, deliveries and pickups mixed, by time; today's late ones first. */
export type DispatchDay = { today: string; date: string; rows: DispatchRow[] };

type Direction = DispatchRow['direction'];

type Row = {
	id: number;
	status: OrderStatus;
	has_incident: number;
	modified_after_staging: number;
	client_attributes: string;
	direction: Direction;
	date: string;
	trip: string;
	extension_ids: string;
};

function toTripFields(trip: DeliveryAttributes | PickupAttributes): TripFields {
	return {
		time: trip.time,
		address1: trip.address_1,
		address2: trip.address_2,
		carrier: trip.carrier
	};
}

function toDispatchRow(row: Row, date: string): DispatchRow {
	const order = {
		id: row.id,
		status: row.status,
		hasIncident: 1 === row.has_incident,
		modifiedAfterStaging: 1 === row.modified_after_staging,
		clientName: clientAttributesSchema.parse(JSON.parse(row.client_attributes)).name,
		date: row.date,
		isLate: row.date < date,
		extensionIds: z.array(z.number()).parse(JSON.parse(row.extension_ids))
	};
	if ('delivery' === row.direction) {
		const trip = deliveryAttributesSchema.parse(JSON.parse(row.trip));
		return { ...order, ...toTripFields(trip), direction: row.direction, method: trip.method };
	}
	const trip = pickupAttributesSchema.parse(JSON.parse(row.trip));
	return { ...order, ...toTripFields(trip), direction: row.direction, method: trip.method };
}

// Only a pickup names its extensions: the lookup scans every order's attributes. An extension is
// born delivered, with nothing that went out: never a delivery.
const EXTENSION_IDS = `(select json_group_array(extension.id) from orders extension
	where json_extract(extension.attributes, '$.parent_order_id') = orders.id)`;
const NOT_EXTENSION = `json_extract(attributes, '$.parent_order_id') is null`;

const marks = (values: readonly string[]) => values.map(() => '?').join(', ');

// Statuses that count from `from` to `to`.
type Window = { statuses: readonly OrderStatus[]; from: string; to: string };

// One direction's trips. The column comes from the code, never from the input.
function selectTrips(direction: Direction, windows: Window[]) {
	const where = windows
		.map(
			(window) => `(status in (${marks(window.statuses)}) and ${direction}_date between ? and ?)`
		)
		.join(' or ');
	const sql = `select id, status, has_incident,
		${MODIFIED_AFTER_STAGING_AT} is not null as modified_after_staging,
		client_attributes, '${direction}' as direction,
		${direction}_date as date, ${direction}_attributes as trip,
		json_extract(${direction}_attributes, '$.time') as time,
		${'pickup' === direction ? EXTENSION_IDS : "'[]'"} as extension_ids
		from orders
		where ${'pickup' === direction ? 'true' : NOT_EXTENSION} and (${where})`;
	return { sql, params: windows.flatMap((window) => [...window.statuses, window.from, window.to]) };
}

// The day's trips; today, also what's pending from up to MAX_LATE_DAYS before.
function windowsOf(direction: Direction, date: string, today: string): Window[] {
	const day = { statuses: ACTIVE, from: date, to: date };
	if (date !== today) {
		return [day];
	}
	const late = {
		statuses: PENDING[direction],
		from: addDays(today, -MAX_LATE_DAYS),
		to: addDays(today, -1)
	};
	return [day, late];
}

/** The list on `date`, today when it's missing or malformed. Open to every role. */
export async function getDispatchDay(
	db: D1Database,
	date: unknown,
	actor: Actor | null
): Promise<DispatchDay> {
	requireRole(actor, ROLES);
	const today = getTodaysDate();
	const day = z.iso.date().catch(today).parse(date);
	const delivery = selectTrips('delivery', windowsOf('delivery', day, today));
	const pickup = selectTrips('pickup', windowsOf('pickup', day, today));
	// Oldest first, then by time, no time last; an order's delivery before its pickup.
	const { results } = await db
		.prepare(
			`select * from (${delivery.sql} union all ${pickup.sql})
			order by date, time is null, time, id, direction`
		)
		.bind(...delivery.params, ...pickup.params)
		.all<Row>();
	return { today, date: day, rows: results.map((row) => toDispatchRow(row, day)) };
}
