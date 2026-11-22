// A quote's state, derived, never stored: open until it's converted, then converted for good, and
// open splits in two by its date. Pure and shared with the browser, so every screen reads the same
// state; the list's SQL filter follows this same rule.

import type { DeliveryMethod, ReturnMethod } from '$lib/server/services/orders';

export const QUOTE_STATES = ['VALID', 'EXPIRED', 'CONVERTED'] as const;

export type QuoteState = (typeof QUOTE_STATES)[number];

export type QuoteValidity = { orderId: number | null; validUntil: string };

/**
 * The same rule in SQL, over `quotes`, for the list's filter: its one parameter is today, Bogotá's.
 * Kept beside getQuoteState, and tested against it.
 */
export const QUOTE_STATE_SQL = `case when order_id is not null then 'CONVERTED'
	when valid_until >= ? then 'VALID' else 'EXPIRED' end`;

/** The only rule for a quote's state. `today` is Bogotá's, from getTodaysDate(): valid through it. */
export function getQuoteState(quote: QuoteValidity, today: string): QuoteState {
	if (null !== quote.orderId) {
		return 'CONVERTED';
	}
	return quote.validUntil >= today ? 'VALID' : 'EXPIRED';
}

/**
 * The end of «Convertir en pedido»'s notice, after «el cliente, las líneas con sus precios, los
 * días,»: what else the quote filled and what's left for the salesperson. A «por acordar»
 * transport is left too, and an event date fills the trips' dates. The methods come from «Quién
 * transporta».
 */
export function describeConversionGaps(quote: {
	eventDate: string | null;
	transportCost: number | null;
}): string {
	const isTransportPending = null === quote.transportCost;
	const filled = isTransportPending
		? 'el descuento y las notas.'
		: 'el descuento, el transporte y las notas.';
	if (null === quote.eventDate) {
		const left = isTransportPending ? 'las fechas y el transporte' : 'las fechas';
		return `${filled} Faltan ${left}.`;
	}
	const left = isTransportPending ? 'las horas y el transporte' : 'las horas';
	return `${filled} La entrega y la recogida salen de la fecha del evento; faltan ${left}.`;
}

/** The note «Duplicar» shows above the grid, naming the inactive products it left out; null for none. */
export function describeRemovedProducts(names: string[]): string | null {
	if (0 === names.length) {
		return null;
	}
	const sorted = [...names].sort((first, second) => first.localeCompare(second, 'es'));
	if (1 === sorted.length) {
		return `Se quitó un producto inactivo: ${sorted[0]}.`;
	}
	return `Se quitaron ${sorted.length} productos inactivos: ${sorted.join(', ')}.`;
}

/** «Quién transporta»: who moves the products both ways, the company or the client. */
export const TRANSPORTED_BY = ['COMPANY', 'CLIENT'] as const;

export type TransportedBy = (typeof TRANSPORTED_BY)[number];

export type OrderMethods = { deliveryMethod: DeliveryMethod; returnMethod: ReturnMethod };

/** The order's two methods «Convertir en pedido» starts with, still editable on the order form. */
export function toOrderMethods(transportedBy: TransportedBy): OrderMethods {
	return 'CLIENT' === transportedBy
		? { deliveryMethod: 'CLIENT_PICKUP', returnMethod: 'CLIENT_RETURN' }
		: { deliveryMethod: 'COMPANY_DELIVERY', returnMethod: 'COMPANY_PICKUP' };
}

/**
 * «Cotizar de nuevo»'s choice, from the order's delivery method: a carrier or a mixed case isn't
 * quotable, so only a client who picks up reads as the client.
 */
export function transportedByOf(deliveryMethod: DeliveryMethod): TransportedBy {
	return 'CLIENT_PICKUP' === deliveryMethod ? 'CLIENT' : 'COMPANY';
}
