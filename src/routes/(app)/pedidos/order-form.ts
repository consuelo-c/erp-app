// The order form posts the whole order as JSON in one field: its lines are a list the browser
// builds as the salesperson types. The service validates it like any other input.
export function readPostedOrder(formData: FormData): unknown {
	try {
		return JSON.parse(String(formData.get('order')));
	} catch {
		return null;
	}
}

/**
 * A search's results by keyboard: the up and down arrows move the focus from the search into its
 * results and through them, and up from the first goes back to the search.
 */
export function moveThroughResults(
	event: KeyboardEvent,
	search: HTMLElement | null,
	results: Iterable<HTMLElement>
): void {
	if ('ArrowDown' !== event.key && 'ArrowUp' !== event.key) {
		return;
	}
	event.preventDefault();
	const stops = [search, ...results].filter((stop) => null !== stop);
	const at = stops.indexOf(document.activeElement as HTMLElement);
	const step = 'ArrowDown' === event.key ? 1 : -1;
	stops[Math.min(Math.max(at + step, 0), stops.length - 1)]?.focus();
}
