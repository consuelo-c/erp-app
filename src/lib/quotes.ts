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
