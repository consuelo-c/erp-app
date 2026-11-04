import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import type { Actor, Role } from '$lib/server/actor';
import { load as loadList } from './+page.server';
import { load as loadDetail } from './[id]/+page.server';

test('SALES, WAREHOUSE and DRIVER get the no-permission screen on /cuentas-de-cobro', async () => {
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const user: Actor = { username: 'ventas', employeeId: null, roles: [role], kind: 'user' };
		const event = {
			locals: { user },
			params: { id: '1' },
			url: new URL('https://erp.test/cuentas-de-cobro'),
			platform: undefined
		};
		for (const handler of [loadList, loadDetail]) {
			await expect(
				(async () => (handler as (event: never) => unknown)(event as never))()
			).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
		}
	}
});
