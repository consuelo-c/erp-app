// An order's totals and its lifecycle. The price is per day: each line is qty × unit price ×
// rental days, and the discount comes off the items only, never off transport. Pure, and every
// input is whole pesos, so nothing rounds. Shared with the browser, so the order form recalculates
// as it's typed and the screens offer only the legal transitions.

import { addDays, getDayOfWeek } from '$lib/datetime';
import { formatBalance, formatPesos } from '$lib/format';
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

/**
 * A cancelled billed order's «A favor del cliente»: its cuenta's credit plus the deposit held,
 * `owedToClient`, named after the cuenta. Null for an order that isn't both.
 */
export function readOwedOnReceivable(
	order: BilledOrder & { status: OrderStatus; owedToClient: number }
): { label: string; amount: string; text: string } | null {
	if ('CANCELLED' !== order.status || null === order.receivableId) {
		return null;
	}
	const label = `A favor del cliente · cuenta de cobro Nº ${order.receivableId}`;
	const amount = formatPesos(order.owedToClient);
	return { label, amount, text: `${label}: ${amount}` };
}

// The cuenta travels with the truck: until the order is delivered, the driver hands it over.
const BEFORE_DELIVERY: readonly OrderStatus[] = ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY'];

/**
 * A billed order's line on the operational detail: «Entregar cuenta de cobro Nº N» before
 * DELIVERED, «Cuenta de cobro Nº N» from it on. Null for an unbilled order. Never a balance: the
 * driver doesn't collect the cuenta.
 */
export function receivableLine(order: {
	receivableId: number | null;
	status: OrderStatus;
}): string | null {
	if (null === order.receivableId) {
		return null;
	}
	return BEFORE_DELIVERY.includes(order.status)
		? `Entregar cuenta de cobro Nº ${order.receivableId}`
		: `Cuenta de cobro Nº ${order.receivableId}`;
}

// A completed order's deposit went back, a cancelled one's is owed back: «$0 de $50.000» would read
// as unpaid.
const DEPOSIT_SETTLED: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED'];

/**
 * The deposit as the client's paper reads it, «$20.000 de $50.000»: received, net of its refunds,
 * of agreed. Null with no agreed deposit, or once the order is completed or cancelled.
 */
export function depositReceivedOfAgreed(order: {
	status: OrderStatus;
	depositAmount: number;
	depositHeld: number;
}): string | null {
	if (0 === order.depositAmount || DEPOSIT_SETTLED.includes(order.status)) {
		return null;
	}
	return `${formatBalance(order.depositHeld)} de ${formatPesos(order.depositAmount)}`;
}

const SUNDAY = 0;
const SATURDAY = 6;

// Delivery is the event's day, or the latest earlier day that's neither a Sunday nor a holiday.
function defaultDeliveryDate(eventDate: string, holidayDates: string[]): string {
	let date = eventDate;
	while (SUNDAY === getDayOfWeek(date) || holidayDates.includes(date)) {
		date = addDays(date, -1);
	}
	return date;
}

// Pickup is the first day after the event that's not a Saturday, a Sunday or a holiday.
function defaultPickupDate(eventDate: string, holidayDates: string[]): string {
	let date = addDays(eventDate, 1);
	while ([SATURDAY, SUNDAY].includes(getDayOfWeek(date)) || holidayDates.includes(date)) {
		date = addDays(date, 1);
	}
	return date;
}

export type TripDates = { deliveryDate: string; pickupDate: string };

export type FollowingTrips = TripDates & { isDeliveryDateTyped: boolean; isPickupDateTyped: boolean };

/**
 * A quote's new order: the trips' dates from the event date, each until it's typed by hand. No
 * event date leaves them as they are.
 */
export function followEventDate(
	eventDate: string,
	trips: FollowingTrips,
	holidayDates: string[]
): TripDates {
	const { deliveryDate, pickupDate } = trips;
	if ('' === eventDate) {
		return { deliveryDate, pickupDate };
	}
	return {
		deliveryDate: trips.isDeliveryDateTyped
			? deliveryDate
			: defaultDeliveryDate(eventDate, holidayDates),
		pickupDate: trips.isPickupDateTyped ? pickupDate : defaultPickupDate(eventDate, holidayDates)
	};
}

/** The order form's warnings for trips on the wrong side of the event. They never block. */
export function findEventDateWarnings(dates: {
	eventDate: string;
	deliveryDate: string;
	pickupDate: string;
}): string[] {
	const { eventDate, deliveryDate, pickupDate } = dates;
	if ('' === eventDate) {
		return [];
	}
	const warnings = [];
	if ('' !== deliveryDate && deliveryDate > eventDate) {
		warnings.push('La entrega es después del evento');
	}
	if ('' !== pickupDate && pickupDate < eventDate) {
		warnings.push('La recogida es antes del evento');
	}
	return warnings;
}

export type OrderMove = {
	from: OrderStatus;
	to: OrderStatus;
	deliveryMethod: DeliveryMethod;
	returnMethod: ReturnMethod;
};

// Once the merchandise is with the client, cancelling no longer undoes anything.
const CANCELLABLE: readonly OrderStatus[] = ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY'];

// The route branches on the methods: nobody drives out when the client picks up at the warehouse,
// nor goes to fetch what the client brings back. Nothing leaves CANCELLED: booking it again is a
// new quote, «Cotizar de nuevo».
function forwardStatus(move: OrderMove): OrderStatus | null {
	const isClientPickup = 'CLIENT_PICKUP' === move.deliveryMethod;
	const isClientReturn = 'CLIENT_RETURN' === move.returnMethod;
	const next: Record<OrderStatus, OrderStatus | null> = {
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

// Cancelling releases the company from the client: it isn't here, so the operational transitions
// can't be used to skip its role lock.
export const OPERATIONAL_STATUSES = [
	'PICKED',
	'OUT_FOR_DELIVERY',
	'DELIVERED',
	'OUT_FOR_PICKUP',
	'COMPLETED'
] as const;

export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

/** The status button's one target, or null: a cancelled or a completed order has none. */
export function nextOperationalStatus(move: Omit<OrderMove, 'to'>): OperationalStatus | null {
	return OPERATIONAL_STATUSES.find((to) => isLegalTransition({ ...move, to })) ?? null;
}

/** Whether a transition belongs to the pickup, and its note with it; otherwise the delivery's. */
export function isPickupStatus(status: OrderStatus): boolean {
	return 'OUT_FOR_PICKUP' === status || 'COMPLETED' === status;
}

// Once the products are on their way back, or the order was cancelled, it's read-only.
const EDITABLE: readonly OrderStatus[] = ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

/** Whether an order in this state can still be edited: from CONFIRMED through DELIVERED. */
export function isEditableStatus(status: OrderStatus): boolean {
	return EDITABLE.includes(status);
}

/** The status a cancelled order was cancelled from, read from its CANCELLED event's `before`. */
export type CancelledFrom = { cancelledFrom: OrderStatus } | null;

/**
 * The only rule for «cancelled on its way»: cancelled from OUT_FOR_DELIVERY, so the merchandise
 * went out and came back. From CONFIRMED or PICKED it never left the warehouse.
 */
export function isCancelledOnItsWay(cancellation: CancelledFrom): boolean {
	return 'OUT_FOR_DELIVERY' === cancellation?.cancelledFrom;
}

// Damage turns up on the return or later, washing: never before the order reaches the client,
// unless it was cancelled on its way and came back.
const REPORTABLE: readonly OrderStatus[] = ['DELIVERED', 'OUT_FOR_PICKUP', 'COMPLETED'];

/** Whether an incident can be reported on an order in this state. */
export function isIncidentReportable(order: {
	status: OrderStatus;
	cancellation: CancelledFrom;
}): boolean {
	return REPORTABLE.includes(order.status) || isCancelledOnItsWay(order.cancellation);
}

// Sales records the money in; only the manager pays it out.
const ORDER_INFLOWS = ['INSTALLMENT', 'SECURITY_DEPOSIT', 'CANCELLATION_FEE'] as const;
const ORDER_OUTFLOWS = ['INSTALLMENT_REFUND', 'DEPOSIT_REFUND', 'CARRIER_PAYMENT'] as const;

/** The movements an order records from its payment entry, in the order the entry offers them. */
export const ORDER_PAYMENT_CONCEPTS = [...ORDER_INFLOWS, ...ORDER_OUTFLOWS] as const;

export type OrderPaymentConcept = (typeof ORDER_PAYMENT_CONCEPTS)[number];

/** Whether the money comes in; the rest goes out. Only the manager records money out, and the fee. */
export function isOrderInflow(concept: OrderPaymentConcept): boolean {
	return (ORDER_INFLOWS as readonly string[]).includes(concept);
}

/** Where a «Cargo por cancelación» comes from: new money, or money the order already holds. */
export const FEE_SOURCES = ['NEW', 'INSTALLMENTS', 'DEPOSIT'] as const;

export type FeeSource = (typeof FEE_SOURCES)[number];

export type PrintSheet = { firstPageLines: number; linesPerPage: number; closingLines: number };

// A landscape half-letter sheet holds its lines in two columns of 13 rows under the client's band,
// 18 on the next sheets. The closing (signature, totals) takes 7 rows of each column on the last
// sheet, and is never split from it.
const HALF_LETTER_SHEET: PrintSheet = { firstPageLines: 26, linesPerPage: 36, closingLines: 14 };

/** One half-letter sheet's lines, left column then right: the left one fills first. */
export function splitIntoColumns<Line>(
	lines: Line[],
	isFirstPage: boolean,
	isLastPage: boolean
): Line[][] {
	const { firstPageLines, linesPerPage, closingLines } = HALF_LETTER_SHEET;
	const room = (isFirstPage ? firstPageLines : linesPerPage) - (isLastPage ? closingLines : 0);
	const columnRows = room / 2;
	return [lines.slice(0, columnRows), lines.slice(columnRows)];
}

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
// margins. The first page gives 17 lines to the opening; the others, 7 to the header and 4 to the
// head of an order that continues on them. «1 de N» sits in the margin, taking no line.
// ponytail: a product name that wraps counts as one line; measure rows if a sheet ever overflows.
const LETTER_SHEET: PrintSheet = { firstPageLines: 42, linesPerPage: 48, closingLines: 17 };
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

/**
 * A cuenta de cobro's orders, sheet by sheet on letter paper. `paidLines` are the rows that follow
 * the last total, «ABONOS» and «SALDO A PAGAR»: in the closing, and under a single order's totals
 * when they stay with its last line.
 */
export function splitOrdersIntoPages<Order extends PrintedOrder>(
	orders: Order[],
	paidLines = 0
): OrderBlock<Order>[][] {
	const lines = orders.flatMap((order) => toPrintedLines(order));
	const totalsLines = BLOCK_TOTALS_LINES + (1 === orders.length ? paidLines : 0);
	const linesOf = (line: PrintedLine<Order>) =>
		1 + (line.isFirst ? BLOCK_HEAD_LINES : 0) + (line.isLast ? totalsLines : 0);
	const sheet = { ...LETTER_SHEET, closingLines: LETTER_SHEET.closingLines + paidLines };
	return splitIntoPages(lines, sheet, linesOf).map(toBlocks);
}

const orderNumbers = new Intl.ListFormat('es');

/** The printout's «Concepto»: `Remisión 1043`, `Remisiones 1060, 1061 y 1072`. */
export function formatRemisiones(orderIds: number[]): string {
	const noun = 1 === orderIds.length ? 'Remisión' : 'Remisiones';
	return `${noun} ${orderNumbers.format(orderIds.map(String))}`;
}

/** Why a billed order's client can't change: its cuenta de cobro bills other orders too. */
export function clientLockedMessage(receivableId: number): string {
	return `Retire el pedido de la cuenta de cobro Nº ${receivableId} antes de cambiar el cliente.`;
}
