import { expect, test } from 'vitest';
import type { OrderStatus } from '$lib/server/services/orders';
import { calculateOrderTotals, isLegalTransition } from './orders';

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

const company = { deliveryMethod: 'COMPANY_DELIVERY', returnMethod: 'COMPANY_PICKUP' } as const;
const external = { deliveryMethod: 'EXTERNAL_CARRIER', returnMethod: 'EXTERNAL_CARRIER' } as const;
const client = { deliveryMethod: 'CLIENT_PICKUP', returnMethod: 'CLIENT_RETURN' } as const;

type Methods = typeof company | typeof external | typeof client;

function isLegal(from: OrderStatus, to: OrderStatus, methods: Methods = company): boolean {
	return isLegalTransition({ from, to, ...methods });
}

test('the straight route: confirm, pick, and from out for pickup to completed', () => {
	for (const methods of [company, external, client]) {
		expect(isLegal('DRAFT', 'CONFIRMED', methods)).toBe(true);
		expect(isLegal('CONFIRMED', 'PICKED', methods)).toBe(true);
		expect(isLegal('OUT_FOR_DELIVERY', 'DELIVERED', methods)).toBe(true);
		expect(isLegal('OUT_FOR_PICKUP', 'COMPLETED', methods)).toBe(true);
	}
});

test('out for delivery is skipped only when the client picks up', () => {
	expect(isLegal('PICKED', 'OUT_FOR_DELIVERY', company)).toBe(true);
	expect(isLegal('PICKED', 'OUT_FOR_DELIVERY', external)).toBe(true);
	expect(isLegal('PICKED', 'OUT_FOR_DELIVERY', client)).toBe(false);
	expect(isLegal('PICKED', 'DELIVERED', client)).toBe(true);
	expect(isLegal('PICKED', 'DELIVERED', company)).toBe(false);
	expect(isLegal('PICKED', 'DELIVERED', external)).toBe(false);
});

test('out for pickup is skipped only when the client brings it back', () => {
	expect(isLegal('DELIVERED', 'OUT_FOR_PICKUP', company)).toBe(true);
	expect(isLegal('DELIVERED', 'OUT_FOR_PICKUP', external)).toBe(true);
	expect(isLegal('DELIVERED', 'OUT_FOR_PICKUP', client)).toBe(false);
	expect(isLegal('DELIVERED', 'COMPLETED', client)).toBe(true);
	expect(isLegal('DELIVERED', 'COMPLETED', company)).toBe(false);
	expect(isLegal('DELIVERED', 'COMPLETED', external)).toBe(false);
});

test('the two axes are independent: client pickup with a company return', () => {
	const mixed = { deliveryMethod: 'CLIENT_PICKUP', returnMethod: 'COMPANY_PICKUP' } as const;
	expect(isLegalTransition({ from: 'PICKED', to: 'DELIVERED', ...mixed })).toBe(true);
	expect(isLegalTransition({ from: 'DELIVERED', to: 'OUT_FOR_PICKUP', ...mixed })).toBe(true);
});

test('cancelling is legal until the merchandise reaches the client', () => {
	for (const from of ['DRAFT', 'CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY'] as const) {
		expect(isLegal(from, 'CANCELLED')).toBe(true);
	}
	for (const from of ['DELIVERED', 'OUT_FOR_PICKUP', 'COMPLETED', 'CANCELLED'] as const) {
		expect(isLegal(from, 'CANCELLED')).toBe(false);
	}
});

test('skipping a state, going back, leaving the end states and moving into DRAFT are illegal', () => {
	expect(isLegal('CONFIRMED', 'DELIVERED')).toBe(false);
	expect(isLegal('PICKED', 'CONFIRMED')).toBe(false);
	expect(isLegal('DRAFT', 'DRAFT')).toBe(false);
	for (const from of ['CONFIRMED', 'DELIVERED', 'COMPLETED', 'CANCELLED'] as const) {
		expect(isLegal(from, 'DRAFT')).toBe(false);
	}
	for (const to of ['DELIVERED', 'OUT_FOR_PICKUP', 'CONFIRMED'] as const) {
		expect(isLegal('COMPLETED', to)).toBe(false);
		expect(isLegal('CANCELLED', to)).toBe(false);
	}
});
