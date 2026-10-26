import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import type { Actor, Role } from '$lib/server/actor';
import { load } from './+page.server';

// The service prints for every role; Pedidos' route stays closed to the warehouse and the driver,
// who print from Despachos.
test('WAREHOUSE and DRIVER get a 403 on the order printout under /pedidos', async () => {
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const user: Actor = { username: 'bodega', employeeId: null, roles: [role], kind: 'user' };
		const event = { locals: { user }, params: { id: '1' }, platform: undefined };
		await expect(load(event as never)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	}
});
