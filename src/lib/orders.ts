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
// nor goes to fetch what the client brings back.
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
		CANCELLED: null
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
