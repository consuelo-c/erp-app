// An order edit as its timeline reads it: each changed field by its Spanish label, the old and new
// value formatted, the lines per product. Pure: the caller reads the event back through its schemas.

import { formatCivilDate, formatClockTime } from '$lib/datetime';
import { formatInteger, formatPesos } from '$lib/format';
import { DELIVERY_METHOD_LABELS, RETURN_METHOD_LABELS } from '$lib/labels';
import { formatPhone } from '$lib/phone';
import type {
	Carrier,
	ClientAttributes,
	DeliveryAttributes,
	EditedFields,
	OrderAttributes,
	OrderItem,
	PickupAttributes
} from './services/orders';

/** One row of an edit's diff: «Transporte», «$150.000 → $180.000». */
export type OrderChange = { label: string; change: string };

// Every key gets a label: a new one is a type error here, never a raw key on the screen.
type Fields<T> = { [K in keyof T]-?: { label: string; format: (value: T[K]) => string } };

function orBlank<T>(format: (value: T) => string) {
	return (value: T | null | undefined) =>
		null === value || undefined === value ? '—' : format(value);
}

const text = orBlank((value: string) => value);
const date = orBlank(formatCivilDate);
const pesos = orBlank(formatPesos);
const clockTime = orBlank(formatClockTime);
const carrier = orBlank((value: Carrier) => value.name);

const CLIENT_FIELDS: Fields<ClientAttributes> = {
	name: { label: 'Cliente', format: text },
	phone: { label: 'Teléfono', format: orBlank(formatPhone) }
};

type Schedule = Pick<EditedFields, 'event_date' | 'delivery_date' | 'pickup_date' | 'rental_days'>;

const SCHEDULE_FIELDS: Fields<Schedule> = {
	event_date: { label: 'Fecha del evento', format: date },
	delivery_date: { label: 'Fecha de entrega', format: date },
	pickup_date: { label: 'Fecha de recogida', format: date },
	rental_days: { label: 'Días cobrados', format: orBlank(formatInteger) }
};

const DELIVERY_FIELDS: Fields<DeliveryAttributes> = {
	method: { label: 'Método de entrega', format: (method) => DELIVERY_METHOD_LABELS[method] },
	time: { label: 'Hora de entrega', format: clockTime },
	address_1: { label: 'Dirección de entrega', format: text },
	address_2: { label: 'Dirección de entrega, segunda línea', format: text },
	carrier: { label: 'Transportador de la entrega', format: carrier },
	notes: { label: 'Notas de la entrega', format: text }
};

const PICKUP_FIELDS: Fields<PickupAttributes> = {
	method: { label: 'Método de retorno', format: (method) => RETURN_METHOD_LABELS[method] },
	time: { label: 'Hora de recogida', format: clockTime },
	address_1: { label: 'Dirección de recogida', format: text },
	address_2: { label: 'Dirección de recogida, segunda línea', format: text },
	carrier: { label: 'Transportador del retorno', format: carrier },
	notes: { label: 'Notas de la recogida', format: text }
};

type Money = Pick<EditedFields, 'discount' | 'transport_cost' | 'deposit_amount'>;

const MONEY_FIELDS: Fields<Money> = {
	discount: { label: 'Descuento', format: pesos },
	transport_cost: { label: 'Transporte', format: pesos },
	deposit_amount: { label: 'Depósito de garantía', format: pesos }
};

const ATTRIBUTE_FIELDS: Fields<OrderAttributes> = {
	parent_order_id: { label: 'Pedido original', format: orBlank((id: number) => `#${id}`) },
	notes: { label: 'Notas', format: text }
};

function changesOf<T extends object>(fields: Fields<T>, before: T, after: T): OrderChange[] {
	return (Object.keys(fields) as (keyof T)[])
		.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
		.map((key) => {
			const { label, format } = fields[key];
			return { label, change: `${format(before[key])} → ${format(after[key])}` };
		});
}

// A JSON column is in the event only when one of its keys changed, and then on both sides.
function columnChanges<T extends object>(fields: Fields<T>, before?: T, after?: T): OrderChange[] {
	return undefined === before || undefined === after ? [] : changesOf(fields, before, after);
}

function quantityAndPrice(line: OrderItem): string {
	return `${formatInteger(line.qty)} × ${formatPesos(line.unit_price)}`;
}

function lineChange(old: OrderItem | undefined, line: OrderItem): OrderChange[] {
	if (undefined === old) {
		return [{ label: line.name, change: `Agregada: ${quantityAndPrice(line)}` }];
	}
	const parts = [];
	if (old.qty !== line.qty) {
		parts.push(`Cantidad ${formatInteger(old.qty)} → ${formatInteger(line.qty)}`);
	}
	if (old.unit_price !== line.unit_price) {
		parts.push(`Precio ${formatPesos(old.unit_price)} → ${formatPesos(line.unit_price)}`);
	}
	return 0 === parts.length ? [] : [{ label: line.name, change: parts.join(' · ') }];
}

// Per product, by its id: the lines kept or added in the new order, then the ones removed.
function lineChanges(before: OrderItem[] = [], after: OrderItem[] = []): OrderChange[] {
	const old = new Map(before.map((line) => [line.product_id, line]));
	const kept = new Set(after.map((line) => line.product_id));
	const removed = before
		.filter((line) => !kept.has(line.product_id))
		.map((line) => ({ label: line.name, change: `Quitada: ${quantityAndPrice(line)}` }));
	return [...after.flatMap((line) => lineChange(old.get(line.product_id), line)), ...removed];
}

/** An `EDITED` event's diff, in the form's order: client, dates, trips, lines, money, notes. */
export function describeOrderEdit(before: EditedFields, after: EditedFields): OrderChange[] {
	return [
		...columnChanges(CLIENT_FIELDS, before.client_attributes, after.client_attributes),
		...changesOf(SCHEDULE_FIELDS, before, after),
		...columnChanges(DELIVERY_FIELDS, before.delivery_attributes, after.delivery_attributes),
		...columnChanges(PICKUP_FIELDS, before.pickup_attributes, after.pickup_attributes),
		...lineChanges(before.order_items, after.order_items),
		...changesOf(MONEY_FIELDS, before, after),
		...columnChanges(ATTRIBUTE_FIELDS, before.attributes, after.attributes)
	];
}
