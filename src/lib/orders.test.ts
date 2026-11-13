import { expect, test } from 'vitest';
import { ORDER_STATUSES, type OrderStatus } from '$lib/server/services/orders';
import {
	calculateOrderTotals,
	isCancelledOnItsWay,
	isIncidentReportable,
	isLegalTransition,
	nextOperationalStatus,
	readReceivableBalance,
	receivableLine,
	formatRemisiones,
	splitIntoColumns,
	splitIntoPages,
	splitOrdersIntoPages
} from './orders';

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

test('the straight route: pick, and from out for pickup to completed', () => {
	for (const methods of [company, external, client]) {
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
	for (const from of ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY'] as const) {
		expect(isLegal(from, 'CANCELLED')).toBe(true);
	}
	for (const from of ['DELIVERED', 'OUT_FOR_PICKUP', 'COMPLETED', 'CANCELLED'] as const) {
		expect(isLegal(from, 'CANCELLED')).toBe(false);
	}
});

test('nothing leaves CANCELLED', () => {
	for (const to of ORDER_STATUSES) {
		expect(isLegal('CANCELLED', to)).toBe(false);
	}
});

test('skipping a state, going back and leaving COMPLETED are illegal', () => {
	expect(isLegal('CONFIRMED', 'DELIVERED')).toBe(false);
	expect(isLegal('PICKED', 'CONFIRMED')).toBe(false);
	for (const to of ['DELIVERED', 'OUT_FOR_PICKUP', 'CONFIRMED'] as const) {
		expect(isLegal('COMPLETED', to)).toBe(false);
		expect(isLegal('CANCELLED', to)).toBe(false);
	}
});

test("the status button's one target follows the methods; cancelled and completed have none", () => {
	const next = (from: OrderStatus, methods: Methods = company) =>
		nextOperationalStatus({ from, ...methods });
	expect(next('CONFIRMED')).toBe('PICKED');
	expect(next('PICKED')).toBe('OUT_FOR_DELIVERY');
	expect(next('PICKED', client)).toBe('DELIVERED');
	expect(next('DELIVERED')).toBe('OUT_FOR_PICKUP');
	expect(next('DELIVERED', client)).toBe('COMPLETED');
	for (const from of ['CANCELLED', 'COMPLETED'] as const) {
		expect(next(from)).toBeNull();
	}
});

test('cancelled on its way: only from OUT_FOR_DELIVERY, read from the cancellation', () => {
	expect(isCancelledOnItsWay({ cancelledFrom: 'OUT_FOR_DELIVERY' })).toBe(true);
	expect(isCancelledOnItsWay({ cancelledFrom: 'CONFIRMED' })).toBe(false);
	expect(isCancelledOnItsWay({ cancelledFrom: 'PICKED' })).toBe(false);
	expect(isCancelledOnItsWay(null)).toBe(false);
	const cancelled = (cancelledFrom: OrderStatus) => ({
		status: 'CANCELLED' as const,
		cancellation: { cancelledFrom }
	});
	expect(isIncidentReportable(cancelled('OUT_FOR_DELIVERY'))).toBe(true);
	expect(isIncidentReportable(cancelled('PICKED'))).toBe(false);
	expect(isIncidentReportable({ status: 'DELIVERED', cancellation: null })).toBe(true);
	expect(isIncidentReportable({ status: 'OUT_FOR_DELIVERY', cancellation: null })).toBe(false);
});

function linesOf(count: number): number[] {
	return Array.from({ length: count }, (_, index) => index);
}

test('up to 12 lines print on one sheet, its closing under them', () => {
	expect(splitIntoPages(linesOf(12))).toEqual([linesOf(12)]);
});

test('45 lines take two sheets: 26 on the first, 19 with the closing on the second', () => {
	const pages = splitIntoPages(linesOf(45));
	expect(pages.map((page) => page.length)).toEqual([26, 19]);
	expect(pages.flat()).toEqual(linesOf(45));
});

test('lines filling the first sheet exactly leave the closing a second one', () => {
	expect(splitIntoPages(linesOf(26))).toEqual([linesOf(26), []]);
});

test('a sheet splits into its two columns, the left one filling first', () => {
	const [first, last] = splitIntoPages(linesOf(45));
	expect(splitIntoColumns(first, true, false).map((column) => column.length)).toEqual([13, 13]);
	expect(splitIntoColumns(last, false, true).map((column) => column.length)).toEqual([11, 8]);
	expect(splitIntoColumns(linesOf(10), true, true).map((column) => column.length)).toEqual([6, 4]);
	expect(splitIntoColumns(linesOf(3), true, true)).toEqual([linesOf(3), []]);
});

function orderOf(id: number, lineCount: number) {
	return { id, items: linesOf(lineCount) };
}

test('three orders of 15 lines take two letter sheets, every line printed once', () => {
	const orders = [orderOf(1, 15), orderOf(2, 15), orderOf(3, 15)];
	const pages = splitOrdersIntoPages(orders);
	expect(pages).toHaveLength(2);
	expect(pages.flat().flatMap((block) => block.items)).toHaveLength(45);
});

test('an order split across sheets closes where its last line is, with its totals', () => {
	const pages = splitOrdersIntoPages([orderOf(1, 15), orderOf(2, 15), orderOf(3, 15)]);
	const blocksOfSecond = pages.flat().filter((block) => 2 === block.order.id);
	expect(blocksOfSecond.map((block) => block.isClosed)).toEqual([false, true]);
	expect(blocksOfSecond[1].items.at(-1)).toBe(14);
});

test('lines that leave no room for the closing give it a sheet of its own, their totals behind', () => {
	const pages = splitOrdersIntoPages([orderOf(1, 30)]);
	expect(pages).toHaveLength(2);
	expect(pages[0][0].isClosed).toBe(true);
	expect(pages[1]).toEqual([]);
});

test('«ABONOS» and «SALDO A PAGAR» take room: a closing that fitted moves to a sheet of its own', () => {
	expect(splitOrdersIntoPages([orderOf(1, 13)])).toHaveLength(1);
	const pages = splitOrdersIntoPages([orderOf(1, 13)], 2);
	expect(pages).toHaveLength(2);
	expect(pages[0][0].isClosed).toBe(true);
	expect(pages[1]).toEqual([]);
});

test('the driver hands a billed order\'s cuenta over until it is delivered, then only names it', () => {
	const line = (status: OrderStatus) => receivableLine({ receivableId: 4794, status });
	for (const status of ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY'] as const) {
		expect(line(status)).toBe('Entregar cuenta de cobro Nº 4794');
	}
	for (const status of ['DELIVERED', 'OUT_FOR_PICKUP', 'COMPLETED', 'CANCELLED'] as const) {
		expect(line(status)).toBe('Cuenta de cobro Nº 4794');
	}
	expect(receivableLine({ receivableId: null, status: 'CONFIRMED' })).toBeNull();
});

test("the concept lists every order's number", () => {
	expect(formatRemisiones([1043])).toBe('Remisión 1043');
	expect(formatRemisiones([1043, 1060])).toBe('Remisiones 1043 y 1060');
	expect(formatRemisiones([1060, 1061, 1072])).toBe('Remisiones 1060, 1061 y 1072');
});

test('a billed order with a balance reads what is pending on its cuenta', () => {
	expect(readReceivableBalance({ receivableId: 4794, receivableBalance: 500000 })).toEqual({
		id: 4794,
		text: 'Saldo pendiente en cuenta de cobro Nº 4794: $500.000',
		label: 'Saldo pendiente en cuenta de cobro Nº 4794',
		amount: '$500.000',
		credit: 0
	});
});

test('a billed order at 0 reads paid, with no amount', () => {
	expect(readReceivableBalance({ receivableId: 4794, receivableBalance: 0 })).toEqual({
		id: 4794,
		text: 'Pagado · cuenta de cobro Nº 4794',
		label: 'Pagado · cuenta de cobro Nº 4794',
		amount: '',
		credit: 0
	});
});

test("a billed order below 0 reads paid and the client's credit", () => {
	expect(readReceivableBalance({ receivableId: 4794, receivableBalance: -20000 })).toEqual({
		id: 4794,
		text: 'Pagado · cuenta de cobro Nº 4794 · Saldo a favor $20.000',
		label: 'Pagado · cuenta de cobro Nº 4794',
		amount: '',
		credit: 20000
	});
});

test('an unbilled order has no reading: it keeps its own balance', () => {
	expect(readReceivableBalance({ receivableId: null, receivableBalance: null })).toBeNull();
});
