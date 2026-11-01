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
		// An expired or revoked session: the copy goes with it, as on logging out.
		if (401 === response.status) {
			clearDispatchCache();
		}
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

// Without a session the phone keeps no clients' data: offline, nothing else would stop it showing.
// The checklists go with it: they're the same phone's notes on the same orders.
export function clearDispatchCache(): void {
	try {
		localStorage.removeItem(DISPATCH_CACHE_KEY);
		localStorage.removeItem(CHECKLIST_KEY);
	} catch {
		// Storage blocked or missing: there's no copy to clear.
	}
}

// The lines the warehouse or the driver has ticked on this phone: a visual aid, never sent to the
// server, kept only so a reload doesn't lose the count. One list per order, for its current status.
export const CHECKLIST_KEY = 'despachos-marcas';

const checklistsSchema = z.record(
	z.string(),
	z.object({ status: z.string(), lines: z.array(z.string()) })
);

type Checklists = z.infer<typeof checklistsSchema>;

/** A line's tick carries its quantity: a line Ventas changes after it was ticked comes back unticked. */
export function lineMark(item: { product_id: number; qty: number }): string {
	return `${item.product_id}:${item.qty}`;
}

function parseChecklists(raw: string | null): Checklists {
	try {
		const checklists = checklistsSchema.safeParse(JSON.parse(raw ?? '{}'));
		return checklists.success ? checklists.data : {};
	} catch {
		return {};
	}
}

/** The order's ticked lines; another status's list is a finished stage's, so it starts empty. */
export function readChecklist(raw: string | null, orderId: string, status: string): string[] {
	const checklist = parseChecklists(raw)[orderId];
	return status === checklist?.status ? checklist.lines : [];
}

export function loadChecklist(orderId: string, status: string): string[] {
	try {
		return readChecklist(localStorage.getItem(CHECKLIST_KEY), orderId, status);
	} catch {
		return [];
	}
}

export function saveChecklist(orderId: string, status: string, lines: string[]): void {
	try {
		const checklists = parseChecklists(localStorage.getItem(CHECKLIST_KEY));
		checklists[orderId] = { status, lines };
		localStorage.setItem(CHECKLIST_KEY, JSON.stringify(checklists));
	} catch {
		// Not kept this time: the ticks on screen still work until a reload.
	}
}
