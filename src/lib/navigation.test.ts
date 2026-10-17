import { expect, test } from 'vitest';
import { findDestination } from './navigation';

test('a path belongs to the destination that holds it, Logins inside Personal', () => {
	expect(findDestination('/despachos')?.label).toBe('Despachos');
	expect(findDestination('/personal/7')?.label).toBe('Personal');
	expect(findDestination('/logins/3/contrasena')?.label).toBe('Personal');
	expect(findDestination('/loginsx')).toBeUndefined();
	expect(findDestination('/')).toBeUndefined();
});
