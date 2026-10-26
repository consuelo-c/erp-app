import { expect, test } from 'vitest';
import { findDestination, getDispatchTab, getPageNumbers } from './navigation';

test('a path belongs to the destination that holds it, Nómina inside Personal y Nómina, Logins inside Sistema', () => {
	expect(findDestination('/despachos')?.label).toBe('Despachos');
	expect(findDestination('/horas/2026-07-30')?.label).toBe('Horas');
	expect(findDestination('/pedidos/1043')?.label).toBe('Pedidos');
	expect(findDestination('/personal/7')?.label).toBe('Personal y Nómina');
	expect(findDestination('/nomina')?.label).toBe('Personal y Nómina');
	expect(findDestination('/logins/3/contrasena')?.label).toBe('Sistema');
	expect(findDestination('/loginsx')).toBeUndefined();
	expect(findDestination('/')).toBeUndefined();
});

test('the pagination shows the first, the last and the neighbors of the current page', () => {
	expect(getPageNumbers(1, 1)).toEqual([1]);
	expect(getPageNumbers(2, 2)).toEqual([1, 2]);
	expect(getPageNumbers(1, 8)).toEqual([1, 2, null, 8]);
	expect(getPageNumbers(5, 8)).toEqual([1, null, 4, 5, 6, 7, 8]);
	expect(getPageNumbers(4, 8)).toEqual([1, 2, 3, 4, 5, null, 8]);
	expect(getPageNumbers(8, 8)).toEqual([1, null, 7, 8]);
});

test('Despachos opens on the first tab that matches the login: a role alone or two together', () => {
	expect(getDispatchTab(['WAREHOUSE'])).toBe('/despachos/preparar');
	expect(getDispatchTab(['DRIVER'])).toBe('/despachos/ruta');
	expect(getDispatchTab(['ADMIN'])).toBe('/despachos/preparar');
	expect(getDispatchTab(['MANAGER'])).toBe('/despachos/preparar');
	expect(getDispatchTab(['SALES'])).toBe('/despachos/sin-ruta');
	expect(getDispatchTab(['DRIVER', 'WAREHOUSE'])).toBe('/despachos/preparar');
	expect(getDispatchTab(['SALES', 'MANAGER'])).toBe('/despachos/preparar');
});
