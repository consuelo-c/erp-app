// Despachos with no signal: today's list and its orders' details, saved on the phone each time the
// list loads with signal, shown read-only when the network fails. Never another day's, never stale.

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { DispatchDay } from './server/services/dispatch';
import type { OrderDetail } from './server/services/orders';

/**
 * An endpoint's JSON, or null when there's no network. Only a failed fetch means offline: an HTTP
 * error (no session, no such order) is thrown as itself, for the error screen.
 */
export async function fetchJson<T>(
	fetch: typeof globalThis.fetch,
	href: string
): Promise<T | null> {
	let response: Response;
	try {
		// Asked as JSON, so an error comes back as `{ message }` and not as an HTML page.
		response = await fetch(href, { headers: { accept: 'application/json' } });
	} catch {
		return null;
	}
	if (!response.ok) {
		// SvelteKit's own error JSON, `{ message }`; anything else falls back to a generic message.
		const body = (await response.json().catch(() => null)) as { message?: string } | null;
		error(response.status, body?.message ?? 'No se pudo cargar');
	}
	return response.json();
}

export const DISPATCH_CACHE_KEY = 'despachos';

/** Shown when there's no network and no copy of today's: different from an empty day. */
export const NO_CACHE_MESSAGE = 'No hay datos descargados para hoy';

// ponytail: the envelope is checked, the rows and details are trusted as this app wrote them; a
// deploy that reshapes them only matters until the next load with signal overwrites the copy.
const dispatchCacheSchema = z.object({
	date: z.iso.date(),
	capturedAt: z.number().int(),
	day: z.custom<DispatchDay>((day) => Array.isArray((day as DispatchDay | null)?.rows)),
	details: z.record(
		z.string(),
		z.custom<OrderDetail>((detail) => 'object' === typeof detail && null !== detail)
	)
});

export type DispatchCache = z.infer<typeof dispatchCacheSchema>;

/** The saved copy if it's `today`'s; a missing, malformed or older one is nothing. */
export function readDispatchCache(raw: string | null, today: string): DispatchCache | null {
	if (null === raw) {
		return null;
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return null;
	}
	const cache = dispatchCacheSchema.safeParse(json);
	return cache.success && today === cache.data.date ? cache.data : null;
}

// Storage can be full, blocked or missing (a private window): the screens work without it.
export function loadDispatchCache(today: string): DispatchCache | null {
	try {
		return readDispatchCache(localStorage.getItem(DISPATCH_CACHE_KEY), today);
	} catch {
		return null;
	}
}

export function saveDispatchCache(cache: DispatchCache): void {
	try {
		localStorage.setItem(DISPATCH_CACHE_KEY, JSON.stringify(cache));
	} catch {
		// No copy this time: the next load with signal tries again.
	}
}
