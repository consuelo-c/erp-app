import { expect, test } from 'vitest';
import { findDestination } from './navigation';

test('a path belongs to the destination that holds it, Nómina inside Personal y Nómina, Logins inside Sistema', () => {
	expect(findDestination('/despachos')?.label).toBe('Despachos');
	expect(findDestination('/horas/2026-07-30')?.label).toBe('Horas');
	expect(findDestination('/personal/7')?.label).toBe('Personal y Nómina');
	expect(findDestination('/nomina')?.label).toBe('Personal y Nómina');
	expect(findDestination('/logins/3/contrasena')?.label).toBe('Sistema');
	expect(findDestination('/loginsx')).toBeUndefined();
	expect(findDestination('/')).toBeUndefined();
});
