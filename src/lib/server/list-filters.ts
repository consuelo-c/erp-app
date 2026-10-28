import { redirect, type Cookies } from '@sveltejs/kit';
import { getTodaysDate } from '$lib/datetime';

// Each list's filters and page, remembered from its last visit, so coming back to it (the back
// arrow, the menu, a tab) shows the same list. Until the browser closes or the login logs out; the
// values are the URL's, so its Zod schemas still check every one.
const LISTS = ['pedidos', 'contactos', 'productos', 'caja'] as const;

// A notice, an open movement or a variant group: where the list was opened, not how it's filtered.
const TRANSIENT = new Set(['guardado', 'aviso', 'movimiento', 'grupo']);

const DISPATCH_DAY_COOKIE = 'filters_despachos';

const OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

/**
 * Saves the URL's filters, or, when it has none, redirects to the ones saved. `?limpiar` forgets
 * them: «Ver todos» and «Limpiar» open the list as it starts.
 */
export function rememberFilters(list: (typeof LISTS)[number], url: URL, cookies: Cookies): void {
	const name = `filters_${list}`;
	if (url.searchParams.has('limpiar')) {
		cookies.delete(name, OPTIONS);
		redirect(307, url.pathname);
	}
	const filters = [...url.searchParams].filter(([key]) => !TRANSIENT.has(key));
	if (0 < filters.length) {
		cookies.set(name, String(new URLSearchParams(filters)), OPTIONS);
		return;
	}
	const saved = cookies.get(name);
	if (saved) {
		const query = new URLSearchParams([...new URLSearchParams(saved), ...url.searchParams]);
		redirect(307, `${url.pathname}?${query}`);
	}
}

/**
 * Despachos' `?fecha=`, remembered by its JSON endpoint: its list loads in the browser, offline
 * too. Only on the day it was picked, so a new day always opens on today.
 */
export function rememberDispatchDay(url: URL, cookies: Cookies): string | null {
	const today = getTodaysDate();
	const picked = url.searchParams.get('fecha');
	if (null !== picked) {
		cookies.set(DISPATCH_DAY_COOKIE, `${today}/${picked}`, OPTIONS);
		return picked;
	}
	const [savedOn, day] = (cookies.get(DISPATCH_DAY_COOKIE) ?? '').split('/');
	return today === savedOn ? (day ?? null) : null;
}

/** On logging out: the next login starts every list afresh. */
export function forgetFilters(cookies: Cookies): void {
	for (const name of [...LISTS.map((list) => `filters_${list}`), DISPATCH_DAY_COOKIE]) {
		cookies.delete(name, OPTIONS);
	}
}
