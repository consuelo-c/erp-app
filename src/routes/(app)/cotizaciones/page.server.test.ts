import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import type { Actor, Role } from '$lib/server/actor';
import { load as loadList } from './+page.server';
import { load as loadNew } from './nueva/+page.server';
import { load as loadDetail } from './[id]/+page.server';
import { load as loadEdit } from './[id]/editar/+page.server';

test('WAREHOUSE and DRIVER get the no-permission screen on every route under /cotizaciones', async () => {
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const user: Actor = { username: 'bodega', employeeId: null, roles: [role], kind: 'user' };
		const event = {
			locals: { user },
			params: { id: '1' },
			url: new URL('https://erp.test/cotizaciones'),
			platform: undefined
		};
		for (const load of [loadList, loadNew, loadDetail, loadEdit]) {
			await expect(
				(async () => (load as (event: never) => unknown)(event as never))()
			).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
		}
	}
});
