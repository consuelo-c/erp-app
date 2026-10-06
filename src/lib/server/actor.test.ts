import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import {
	hasAnyRole,
	hasRole,
	isAdmin,
	isAdminOrManager,
	requireRole,
	rolesSchema,
	type Actor,
	type Role
} from './actor';

function userWith(roles: Role[]): Actor {
	return { username: 'test', employeeId: null, roles, kind: 'user' };
}

test('a multi-role user passes a check for any one of their roles', () => {
	const warehouseDriver = userWith(['WAREHOUSE', 'DRIVER']);
	expect(hasAnyRole(warehouseDriver, ['DRIVER'])).toBe(true);
	expect(hasRole(warehouseDriver, 'WAREHOUSE')).toBe(true);
	expect(hasAnyRole(warehouseDriver, ['SALES', 'MANAGER'])).toBe(false);
});

test('isAdminOrManager accepts either role and rejects SALES', () => {
	expect(isAdminOrManager(userWith(['SALES']))).toBe(false);
	expect(isAdminOrManager(userWith(['MANAGER', 'SALES']))).toBe(true);
	expect(isAdminOrManager(userWith(['ADMIN']))).toBe(true);
});

test('isAdmin rejects MANAGER', () => {
	expect(isAdmin(userWith(['MANAGER']))).toBe(false);
	expect(isAdmin(userWith(['ADMIN']))).toBe(true);
});

test('requireRole throws a 403 only when no role matches', () => {
	const salesperson = userWith(['SALES']);
	expect(() => requireRole(salesperson, ['SALES', 'MANAGER'])).not.toThrow();
	try {
		requireRole(salesperson, ['ADMIN']);
		expect.unreachable();
	} catch (thrown) {
		expect(isHttpError(thrown, 403)).toBe(true);
	}
});

test('rolesSchema rejects an empty array, CLIENT and duplicates', () => {
	expect(rolesSchema.safeParse(['WAREHOUSE', 'DRIVER']).success).toBe(true);
	expect(rolesSchema.safeParse([]).success).toBe(false);
	expect(rolesSchema.safeParse(['CLIENT']).success).toBe(false);
	expect(rolesSchema.safeParse(['SALES', 'SALES']).success).toBe(false);
});
