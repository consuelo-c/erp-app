// An order's totals and its lifecycle. The price is per day: each line is qty × unit price ×
// rental days, and the discount comes off the items only, never off transport. Pure, and every
// input is whole pesos, so nothing rounds. Shared with the browser, so the order form recalculates
// as it's typed and the screens offer only the legal transitions.

import { formatPesos } from '$lib/format';
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

export type BilledOrder = { receivableId: number | null; receivableBalance: number | null };

export type ReceivableReading = {
	id: number;
	/** The sentence, for where it reads as a line of text. */
	text: string;
	/** Label and amount, for where it reads as a totals row: the amount is empty once it's paid. */
	label: string;
	amount: string;
	/** What the client paid over the cuenta's total, or 0. */
	credit: number;
};

/**
 * The only reading of a billed order's money: its cuenta's balance, since a payment on the cuenta
 * isn't assigned to any order. Null for an unbilled order, which reads its own «Pagado» and «Saldo».
 */
export function readReceivableBalance(order: BilledOrder): ReceivableReading | null {
	const { receivableId: id, receivableBalance: balance } = order;
	if (null === id || null === balance) {
		return null;
	}
	if (balance > 0) {
		const label = `Saldo pendiente en cuenta de cobro Nº ${id}`;
		const amount = formatPesos(balance);
		return { id, text: `${label}: ${amount}`, label, amount, credit: 0 };
	}
	const label = `Pagado · cuenta de cobro Nº ${id}`;
	const credit = Math.max(0, -balance);
	const text = credit > 0 ? `${label} · Saldo a favor ${formatPesos(credit)}` : label;
	return { id, text, label, amount: '', credit };
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
// signature take the room of `closingLines` of them, and are never split across two sheets.
export const LINES_PER_PAGE = 20;

export type PrintSheet = { firstPageLines: number; linesPerPage: number; closingLines: number };

const HALF_LETTER_SHEET: PrintSheet = {
	firstPageLines: LINES_PER_PAGE,
	linesPerPage: LINES_PER_PAGE,
	closingLines: 10
};

/**
 * The printout's lines, sheet by sheet: the last one keeps room for the totals and signature.
 * `linesOf` says how many lines of room one takes, for a line that carries more than itself.
 */
export function splitIntoPages<Line>(
	lines: Line[],
	sheet: PrintSheet = HALF_LETTER_SHEET,
	linesOf: (line: Line) => number = () => 1
): Line[][] {
	const pages: Line[][] = [[]];
	let usedLines = 0;
	const roomOnPage = () => (1 === pages.length ? sheet.firstPageLines : sheet.linesPerPage);
	for (const line of lines) {
		if (usedLines + linesOf(line) > roomOnPage()) {
			pages.push([]);
			usedLines = 0;
		}
		pages[pages.length - 1].push(line);
		usedLines += linesOf(line);
	}
	if (usedLines > roomOnPage() - sheet.closingLines) {
		pages.push([]);
	}
	return pages;
}

// A letter sheet in lines of 16px, the row height of the cuenta de cobro's table: 952px between its
// margins. The first page gives 17 lines to the opening and one to «Continúa»; the others, 7 to the
// header and 4 to the head of an order that continues on them.
// ponytail: a product name that wraps counts as one line; measure rows if a sheet ever overflows.
const LETTER_SHEET: PrintSheet = { firstPageLines: 41, linesPerPage: 48, closingLines: 17 };
const BLOCK_HEAD_LINES = 4;
const BLOCK_TOTALS_LINES = 5;

type PrintedOrder = { id: number; items: unknown[] };

type PrintedLine<Order extends PrintedOrder> = {
	order: Order;
	item: Order['items'][number];
	isFirst: boolean;
	isLast: boolean;
};

/** An order's lines on one sheet. `isClosed` when its totals go under them, on this sheet. */
export type OrderBlock<Order extends PrintedOrder> = {
	order: Order;
	items: Order['items'];
	isClosed: boolean;
};

function toPrintedLines<Order extends PrintedOrder>(order: Order): PrintedLine<Order>[] {
	return order.items.map((item, index) => ({
		order,
		item,
		isFirst: 0 === index,
		isLast: order.items.length - 1 === index
	}));
}

// The head rides on an order's first line and the totals on its last: neither is left alone.
function linesOfPrinted<Order extends PrintedOrder>(line: PrintedLine<Order>): number {
	return 1 + (line.isFirst ? BLOCK_HEAD_LINES : 0) + (line.isLast ? BLOCK_TOTALS_LINES : 0);
}

function toBlocks<Order extends PrintedOrder>(lines: PrintedLine<Order>[]): OrderBlock<Order>[] {
	const blocks: OrderBlock<Order>[] = [];
	for (const { order, item, isLast } of lines) {
		const block = blocks.at(-1);
		if (order.id === block?.order.id) {
			block.items.push(item);
			block.isClosed = isLast;
		} else {
			blocks.push({ order, items: [item], isClosed: isLast });
		}
	}
	return blocks;
}

/** A cuenta de cobro's orders, sheet by sheet on letter paper. */
export function splitOrdersIntoPages<Order extends PrintedOrder>(
	orders: Order[]
): OrderBlock<Order>[][] {
	const lines = orders.flatMap((order) => toPrintedLines(order));
	return splitIntoPages(lines, LETTER_SHEET, linesOfPrinted).map(toBlocks);
}

const orderNumbers = new Intl.ListFormat('es');

/** The printout's «Concepto»: `Remisión 1043`, `Remisiones 1060, 1061 y 1072`. */
export function formatRemisiones(orderIds: number[]): string {
	const noun = 1 === orderIds.length ? 'Remisión' : 'Remisiones';
	return `${noun} ${orderNumbers.format(orderIds.map(String))}`;
}
