import type { Cookies } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import { rememberEmployee } from './chosen-employee';

// Just enough of SvelteKit's cookies: what's set is what's read back.
function fakeCookies(): Cookies {
	const jar = new Map<string, string>();
	return {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string) => jar.set(name, value)
	} as unknown as Cookies;
}

test('the employee in the URL is remembered for the next screen that names none', () => {
	const cookies = fakeCookies();
	expect(rememberEmployee(new URL('https://erp.test/nomina'), cookies)).toBeNull();
	expect(rememberEmployee(new URL('https://erp.test/horas/empleado?empleado=7'), cookies)).toBe(
		'7'
	);
	expect(rememberEmployee(new URL('https://erp.test/nomina?semana=2026-10-12'), cookies)).toBe('7');
	expect(rememberEmployee(new URL('https://erp.test/nomina?empleado=3'), cookies)).toBe('3');
	expect(rememberEmployee(new URL('https://erp.test/horas/empleado'), cookies)).toBe('3');
});
