import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import type { Actor, Role } from '$lib/server/actor';
import { load as loadList } from './+page.server';
import { actions as newActions, load as loadNew } from './nueva/+page.server';
import { load as loadDetail } from './[id]/+page.server';
import { actions as editActions, load as loadEdit } from './[id]/editar/+page.server';
import { load as loadTimeline } from './[id]/historial/+page.server';
import { GET as getChange } from './[id]/historial/[evento]/+server';
import { load as loadPrintout } from './[id]/impresion/+page.server';

test('WAREHOUSE and DRIVER get the no-permission screen on every route under /cotizaciones', async () => {
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const user: Actor = { username: 'bodega', employeeId: null, roles: [role], kind: 'user' };
		const event = {
			locals: { user },
			params: { id: '1', evento: '1' },
			url: new URL('https://erp.test/cotizaciones'),
			platform: undefined
		};
		const handlers = [
			loadList,
			loadNew,
			loadDetail,
			loadEdit,
			loadTimeline,
			loadPrintout,
			getChange,
			newActions.default,
			editActions.default
		];
		for (const handler of handlers) {
			await expect(
				(async () => (handler as (event: never) => unknown)(event as never))()
			).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
		}
	}
});
