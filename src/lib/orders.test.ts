import { expect, test } from 'vitest';
import { calculateOrderTotals } from './orders';

// The Design Brief's order #1043.
const order1043 = {
	lines: [
		{ qty: 120, unit_price: 2500 },
		{ qty: 12, unit_price: 12000 },
		{ qty: 120, unit_price: 900 }
	],
	rentalDays: 2,
	discount: 104000,
	transportCost: 180000
};

test("order #1043's lines, subtotal and total", () => {
	expect(calculateOrderTotals(order1043)).toEqual({
		lineTotals: [600000, 288000, 216000],
		itemsTotal: 1104000,
		orderTotal: 1180000
	});
});

test('a discount equal to the subtotal leaves the transport whole', () => {
	const totals = calculateOrderTotals({ ...order1043, discount: 1104000 });
	expect(totals.orderTotal).toBe(180000);
});
