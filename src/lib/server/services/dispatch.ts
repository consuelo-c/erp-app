// Despachos: the day's to-do lists, what to deliver and what to pick up, by who moves it.

import { z } from 'zod';
import { addDays, getTodaysDate } from '$lib/datetime';
import { ROLES, requireRole, type Actor } from '../actor';
import {
	clientAttributesSchema,
	DELIVERY_METHODS,
	deliveryAttributesSchema,
	pickupAttributesSchema,
	RETURN_METHODS,
	type Carrier,
	type DeliveryMethod,
	type OrderStatus,
	type ReturnMethod
} from './orders';

// A delivery is pending until it's delivered; a pickup, until it's back.
const DELIVERY_PENDING = ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY'] as const;
const PICKUP_PENDING = ['DELIVERED', 'OUT_FOR_PICKUP'] as const;

type Trips<Method> = { methods: readonly Method[]; statuses: readonly OrderStatus[] };

type ListSpec = { delivery: Trips<DeliveryMethod>; pickup: Trips<ReturnMethod> };

// A row 5 or more days late is no longer the day's work, in any list: Pedidos still has it.
const MAX_LATE_DAYS = 4;

/** «Ruta de hoy», «Preparar hoy» and «Sin ruta»: the trips each list holds, by method and status. */
export const DISPATCH_LISTS = {
	ROUTE: {
		delivery: { methods: ['COMPANY_DELIVERY'], statuses: DELIVERY_PENDING },
		pickup: { methods: ['COMPANY_PICKUP'], statuses: PICKUP_PENDING }
	},
	// A delivery already out has nothing left to prepare; what comes back still has to be received.
	PREP: {
		delivery: { methods: DELIVERY_METHODS, statuses: ['CONFIRMED', 'PICKED'] },
		pickup: { methods: RETURN_METHODS, statuses: PICKUP_PENDING }
	},
	NO_ROUTE: {
		delivery: { methods: ['CLIENT_PICKUP', 'EXTERNAL_CARRIER'], statuses: DELIVERY_PENDING },
		pickup: { methods: ['CLIENT_RETURN', 'EXTERNAL_CARRIER'], statuses: PICKUP_PENDING }
	}
} as const satisfies Record<string, ListSpec>;

export type DispatchList = keyof typeof DISPATCH_LISTS;

/** One row of a list: an order's delivery or its pickup, never both. */
export type DispatchRow = {
	id: number;
	status: OrderStatus;
	hasIncident: boolean;
	clientName: string;
	date: string;
	isLate: boolean;
	time: string | null;
	method: DeliveryMethod | ReturnMethod;
	address1: string;
	address2: string | null;
	carrier: Carrier | null;
	/** A pickup's extensions: the products some of them keep go on in those orders. */
	extensionIds: number[];
};

export type DispatchDay = { today: string; deliveries: DispatchRow[]; pickups: DispatchRow[] };

type Row = {
	id: number;
	status: OrderStatus;
	has_incident: number;
	client_attributes: string;
	date: string;
	trip: string;
	extension_ids: string;
};

// The column comes from the code, never from the input.
const TRIP_SCHEMAS = { delivery: deliveryAttributesSchema, pickup: pickupAttributesSchema };

type Direction = keyof typeof TRIP_SCHEMAS;

function toDispatchRow(row: Row, direction: Direction, today: string): DispatchRow {
	const trip = TRIP_SCHEMAS[direction].parse(JSON.parse(row.trip));
	return {
		id: row.id,
		status: row.status,
		hasIncident: 1 === row.has_incident,
		clientName: clientAttributesSchema.parse(JSON.parse(row.client_attributes)).name,
		date: row.date,
		isLate: row.date < today,
		time: trip.time,
		method: trip.method,
		address1: trip.address_1,
		address2: trip.address_2,
		carrier: trip.carrier,
		extensionIds:
			'pickup' === direction ? z.array(z.number()).parse(JSON.parse(row.extension_ids)) : []
	};
}

const marks = (values: readonly string[]) => values.map(() => '?').join(', ');

type Window = { earliest: string; today: string };

// Pending on its date or any of the days after it up to today: late ones first, oldest first, then
// by time, no time last.
async function findTrips(
	db: D1Database,
	direction: Direction,
	{ trips: { methods, statuses }, window }: { trips: Trips<string>; window: Window }
): Promise<DispatchRow[]> {
	const time = `json_extract(${direction}_attributes, '$.time')`;
	const { results } = await db
		.prepare(
			`select id, status, has_incident, client_attributes, ${direction}_date as date,
			${direction}_attributes as trip,
			(select json_group_array(extension.id) from orders extension
				where json_extract(extension.attributes, '$.parent_order_id') = orders.id) as extension_ids
			from orders
			where status in (${marks(statuses)}) and ${direction}_date between ? and ?
			and json_extract(${direction}_attributes, '$.method') in (${marks(methods)})
			order by ${direction}_date, ${time} is null, ${time}, id`
		)
		.bind(...statuses, window.earliest, window.today, ...methods)
		.all<Row>();
	return results.map((row) => toDispatchRow(row, direction, window.today));
}

const listSchema = z.enum(Object.keys(DISPATCH_LISTS) as [DispatchList, ...DispatchList[]]);

/** Today's deliveries and pickups still to do in one list, open to every role. */
export async function getDispatchDay(
	db: D1Database,
	list: unknown,
	actor: Actor | null
): Promise<DispatchDay> {
	requireRole(actor, ROLES);
	const spec: ListSpec = DISPATCH_LISTS[listSchema.parse(list)];
	const today = getTodaysDate();
	const window = { earliest: addDays(today, -MAX_LATE_DAYS), today };
	const [deliveries, pickups] = await Promise.all([
		findTrips(db, 'delivery', { trips: spec.delivery, window }),
		findTrips(db, 'pickup', { trips: spec.pickup, window })
	]);
	return { today, deliveries, pickups };
}
