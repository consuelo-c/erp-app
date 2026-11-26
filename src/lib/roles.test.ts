import { expect, test } from 'vitest';
import { POLICIES, ROLES } from './roles';

test('every policy lets in at least one role, and only real ones', () => {
	for (const [key, roles] of Object.entries(POLICIES)) {
		expect(roles.length, key).toBeGreaterThan(0);
		expect(
			roles.every((role) => ROLES.includes(role)),
			key
		).toBe(true);
	}
});
