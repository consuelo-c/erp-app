// An order's totals and its lifecycle. The price is per day: each line is qty × unit price ×
// rental days, and the discount comes off the items only, never off transport. Pure, and every
// input is whole pesos, so nothing rounds. Shared with the browser, so the order form recalculates
// as it's typed and the screens offer only the legal transitions.

import type { DeliveryMethod, OrderStatus, ReturnMethod } from '$lib/server/services/orders';

export type PricedLine = { qty: number; unit_price: number };

export type OrderPricing = {
	lines: PricedLine[];
	rentalDays: number;
	discount: number;
	transportCost: number;
};

export type OrderTotals = { lineTotals: number[]; itemsTotal: number; orderTotal: number };

export function calculateOrderTotals(order: OrderPricing): OrderTotals {
	const lineTotals = order.lines.map((line) => line.qty * line.unit_price * order.rentalDays);
	const itemsTotal = lineTotals.reduce((sum, lineTotal) => sum + lineTotal, 0);
	return { lineTotals, itemsTotal, orderTotal: itemsTotal - order.discount + order.transportCost };
}

export type OrderMove = {
	from: OrderStatus;
	to: OrderStatus;
	deliveryMethod: DeliveryMethod;
	returnMethod: ReturnMethod;
};

// Once the merchandise is with the client, cancelling no longer undoes anything.
const CANCELLABLE: readonly OrderStatus[] = ['DRAFT', 'CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY'];

// The route branches on the methods: nobody drives out when the client picks up at the warehouse,
// nor goes to fetch what the client brings back. A cancelled order reopens as a draft, often for
// another date: confirming it again re-checks the availability it released.
function forwardStatus(move: OrderMove): OrderStatus | null {
	const isClientPickup = 'CLIENT_PICKUP' === move.deliveryMethod;
	const isClientReturn = 'CLIENT_RETURN' === move.returnMethod;
	const next: Record<OrderStatus, OrderStatus | null> = {
		DRAFT: 'CONFIRMED',
		CONFIRMED: 'PICKED',
		PICKED: isClientPickup ? 'DELIVERED' : 'OUT_FOR_DELIVERY',
		OUT_FOR_DELIVERY: 'DELIVERED',
		DELIVERED: isClientReturn ? 'COMPLETED' : 'OUT_FOR_PICKUP',
		OUT_FOR_PICKUP: 'COMPLETED',
		COMPLETED: null,
		CANCELLED: 'DRAFT'
	};
	return next[move.from];
}

/** The only place that decides whether an order may move from one state to another. */
export function isLegalTransition(move: OrderMove): boolean {
	if ('CANCELLED' === move.to) {
		return CANCELLABLE.includes(move.from);
	}
	return move.to === forwardStatus(move);
}

// Confirming and cancelling commit the company to the client, or release it: they aren't here,
// so the operational transitions can't be used to skip their role lock.
export const OPERATIONAL_STATUSES = [
	'PICKED',
	'OUT_FOR_DELIVERY',
	'DELIVERED',
	'OUT_FOR_PICKUP',
	'COMPLETED'
] as const;

export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

/** The status button's one target, or null: a draft, a cancelled or a completed order has none. */
export function nextOperationalStatus(move: Omit<OrderMove, 'to'>): OperationalStatus | null {
	return OPERATIONAL_STATUSES.find((to) => isLegalTransition({ ...move, to })) ?? null;
}

/** Whether a transition belongs to the pickup, and its note with it; otherwise the delivery's. */
export function isPickupStatus(status: OrderStatus): boolean {
	return 'OUT_FOR_PICKUP' === status || 'COMPLETED' === status;
}

// Once the products are on their way back, or the order was cancelled, it's read-only.
const EDITABLE: readonly OrderStatus[] = [
	'DRAFT',
	'CONFIRMED',
	'PICKED',
	'OUT_FOR_DELIVERY',
	'DELIVERED'
];

/** Whether an order in this state can still be edited: from DRAFT through DELIVERED. */
export function isEditableStatus(status: OrderStatus): boolean {
	return EDITABLE.includes(status);
}

// Damage turns up on the return or later, washing: never before the order reaches the client.
const REPORTABLE: readonly OrderStatus[] = ['DELIVERED', 'OUT_FOR_PICKUP', 'COMPLETED'];

/** Whether an incident can be reported on an order in this state. */
export function isIncidentReportable(status: OrderStatus): boolean {
	return REPORTABLE.includes(status);
}

// Sales records the money in; only the manager pays it out.
const ORDER_INFLOWS = ['INSTALLMENT', 'SECURITY_DEPOSIT'] as const;
const ORDER_OUTFLOWS = ['INSTALLMENT_REFUND', 'DEPOSIT_REFUND', 'CARRIER_PAYMENT'] as const;

/** The movements an order records from its payment entry, in the order the entry offers them. */
export const ORDER_PAYMENT_CONCEPTS = [...ORDER_INFLOWS, ...ORDER_OUTFLOWS] as const;

export type OrderPaymentConcept = (typeof ORDER_PAYMENT_CONCEPTS)[number];

/** Whether the money comes in: the rest goes out, and only the manager records it. */
export function isOrderInflow(concept: OrderPaymentConcept): boolean {
	return (ORDER_INFLOWS as readonly string[]).includes(concept);
}

// A half-letter sheet holds this many lines under the order's header. The totals and the
// signature take the room of CLOSING_LINES of them, and are never split across two sheets.
export const LINES_PER_PAGE = 20;
const CLOSING_LINES = 10;

/** The printout's lines, sheet by sheet: the last one keeps room for the totals and signature. */
export function splitIntoPages<Line>(lines: Line[]): Line[][] {
	const pages: Line[][] = [];
	for (let start = 0; start < lines.length; start += LINES_PER_PAGE) {
		pages.push(lines.slice(start, start + LINES_PER_PAGE));
	}
	const lastPage = pages.at(-1);
	if (undefined === lastPage || lastPage.length > LINES_PER_PAGE - CLOSING_LINES) {
		pages.push([]);
	}
	return pages;
}
