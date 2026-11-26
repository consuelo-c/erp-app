import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import { POLICIES, type Role } from '$lib/roles';
import { hasAnyRole, hasRole, requireRole, rolesSchema, type Actor } from './actor';

function userWith(roles: Role[]): Actor {
	return { username: 'test', employeeId: null, roles, kind: 'user' };
}

test('a multi-role user passes a check for any one of their roles', () => {
	const warehouseDriver = userWith(['WAREHOUSE', 'DRIVER']);
	expect(hasAnyRole(warehouseDriver, POLICIES.driverPayments)).toBe(true);
	expect(hasRole(warehouseDriver, 'WAREHOUSE')).toBe(true);
	expect(hasAnyRole(warehouseDriver, POLICIES.orders)).toBe(false);
});

test('requireRole throws a 403 only when no role matches', () => {
	const salesperson = userWith(['SALES']);
	expect(() => requireRole(salesperson, POLICIES.orders)).not.toThrow();
	try {
		requireRole(salesperson, POLICIES.logins);
		expect.unreachable();
	} catch (thrown) {
		expect(isHttpError(thrown, 403)).toBe(true);
	}
});

test('requireRole throws a 401 without an actor, whatever the roles', () => {
	try {
		requireRole(null, POLICIES.anyLogin);
		expect.unreachable();
	} catch (thrown) {
		expect(isHttpError(thrown, 401)).toBe(true);
	}
});

test('rolesSchema rejects an empty array, CLIENT and duplicates', () => {
	expect(rolesSchema.safeParse(['WAREHOUSE', 'DRIVER']).success).toBe(true);
	expect(rolesSchema.safeParse([]).success).toBe(false);
	expect(rolesSchema.safeParse(['CLIENT']).success).toBe(false);
	expect(rolesSchema.safeParse(['SALES', 'SALES']).success).toBe(false);
});
