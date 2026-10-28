import { expect, test } from 'vitest';
import { findDestination, getPageNumbers } from './navigation';

test('a path belongs to the destination that holds it, Personal and Nómina apart', () => {
	expect(findDestination('/despachos')?.label).toBe('Despachos');
	expect(findDestination('/horas/2026-07-30')?.label).toBe('Horas');
	expect(findDestination('/pedidos/1043')?.label).toBe('Pedidos');
	expect(findDestination('/personal/7')?.label).toBe('Personal');
	expect(findDestination('/nomina/comprobante')?.label).toBe('Nómina');
	expect(findDestination('/inventario/revisar/3')?.label).toBe('Inventario');
	expect(findDestination('/')).toBeUndefined();
});

test('Logins is its own destination, outside Configuración, whose tabs keep Nómina', () => {
	expect(findDestination('/logins/3/contrasena')?.label).toBe('Logins');
	expect(findDestination('/loginsx')).toBeUndefined();
	expect(findDestination('/configuracion/nomina')?.label).toBe('Configuración');
});

test('the pagination shows the first, the last and the neighbors of the current page', () => {
	expect(getPageNumbers(1, 1)).toEqual([1]);
	expect(getPageNumbers(2, 2)).toEqual([1, 2]);
	expect(getPageNumbers(1, 8)).toEqual([1, 2, null, 8]);
	expect(getPageNumbers(5, 8)).toEqual([1, null, 4, 5, 6, 7, 8]);
	expect(getPageNumbers(4, 8)).toEqual([1, 2, 3, 4, 5, null, 8]);
	expect(getPageNumbers(8, 8)).toEqual([1, null, 7, 8]);
});
