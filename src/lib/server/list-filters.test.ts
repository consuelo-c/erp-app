import { isRedirect, type Cookies } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import { getTodaysDate } from '$lib/datetime';
import { forgetFilters, rememberDispatchDay, rememberFilters } from './list-filters';

function jar(): Cookies {
	const values = new Map<string, string>();
	return {
		get: (name: string) => values.get(name),
		set: (name: string, value: string) => void values.set(name, value),
		delete: (name: string) => void values.delete(name)
	} as unknown as Cookies;
}

function redirectOf(run: () => void): string | null {
	try {
		run();
		return null;
	} catch (thrown) {
		if (isRedirect(thrown)) {
			return thrown.location;
		}
		throw thrown;
	}
}

const at = (path: string) => new URL(path, 'https://erp.test');

test('a bare list goes back to its last filters, a notice kept, until ?limpiar', () => {
	const cookies = jar();
	expect(redirectOf(() => rememberFilters('pedidos', at('/pedidos'), cookies))).toBeNull();
	rememberFilters('pedidos', at('/pedidos?texto=luz&pagina=2'), cookies);

	expect(redirectOf(() => rememberFilters('pedidos', at('/pedidos'), cookies))).toBe(
		'/pedidos?texto=luz&pagina=2'
	);
	// Each list its own.
	expect(redirectOf(() => rememberFilters('contactos', at('/contactos'), cookies))).toBeNull();
	rememberFilters('contactos', at('/contactos?texto=&servicio=EMPLOYEE'), cookies);
	expect(redirectOf(() => rememberFilters('contactos', at('/contactos?guardado'), cookies))).toBe(
		'/contactos?texto=&servicio=EMPLOYEE&guardado='
	);

	expect(redirectOf(() => rememberFilters('pedidos', at('/pedidos?limpiar'), cookies))).toBe(
		'/pedidos'
	);
	expect(redirectOf(() => rememberFilters('pedidos', at('/pedidos'), cookies))).toBeNull();

	forgetFilters(cookies);
	expect(redirectOf(() => rememberFilters('contactos', at('/contactos'), cookies))).toBeNull();
});

test("Despachos' day is remembered only on the day it was picked", () => {
	const cookies = jar();
	expect(rememberDispatchDay(at('/despachos/dia'), cookies)).toBeNull();
	expect(rememberDispatchDay(at('/despachos/dia?fecha=2026-07-10'), cookies)).toBe('2026-07-10');
	expect(rememberDispatchDay(at('/despachos/dia'), cookies)).toBe('2026-07-10');

	cookies.set('filters_despachos', '2026-07-09/2026-07-10', { path: '/' });
	expect(getTodaysDate()).not.toBe('2026-07-09');
	expect(rememberDispatchDay(at('/despachos/dia'), cookies)).toBeNull();
});
