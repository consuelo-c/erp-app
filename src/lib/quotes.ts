// A quote's state, derived, never stored: open until it's converted, then converted for good, and
// open splits in two by its date. Pure and shared with the browser, so every screen reads the same
// state; the list's SQL filter follows this same rule.

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
 * transport is left too, and an event date fills the trips' dates.
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
		const left = isTransportPending ? 'las fechas, los métodos y el transporte' : 'las fechas y los métodos';
		return `${filled} Faltan ${left}.`;
	}
	const left = isTransportPending ? 'las horas, los métodos y el transporte' : 'las horas y los métodos';
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
