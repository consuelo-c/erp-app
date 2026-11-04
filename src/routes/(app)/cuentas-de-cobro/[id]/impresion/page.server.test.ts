import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import type { Actor, Role } from '$lib/server/actor';
import { load } from './+page.server';

test('SALES, WAREHOUSE and DRIVER get a 403 on the printout', async () => {
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const user: Actor = { username: 'ventas', employeeId: null, roles: [role], kind: 'user' };
		const event = { locals: { user }, params: { id: '4794' }, platform: undefined };
		await expect(load(event as never)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	}
});
