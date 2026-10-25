// An order's totals. The price is per day: each line is qty × unit price × rental days, and the
// discount comes off the items only, never off transport. Pure, and every input is whole pesos, so
// nothing rounds. Shared with the browser, so the order form recalculates as it's typed.

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
