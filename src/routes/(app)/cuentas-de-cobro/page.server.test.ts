import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import type { Actor, Role } from '$lib/server/actor';
import { load as loadList } from './+page.server';
import { load as loadDetail } from './[id]/+page.server';
import { actions as editActions, load as loadEdit } from './[id]/editar/+page.server';
import { actions as issueActions, load as loadIssue } from './nueva/+page.server';

test('SALES, WAREHOUSE and DRIVER get the no-permission screen on every /cuentas-de-cobro route', async () => {
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const user: Actor = { username: 'ventas', employeeId: null, roles: [role], kind: 'user' };
		const event = {
			locals: { user },
			params: { id: '1' },
			url: new URL('https://erp.test/cuentas-de-cobro'),
			platform: undefined
		};
		for (const handler of [
			loadList,
			loadDetail,
			loadIssue,
			loadEdit,
			issueActions.default,
			editActions.default
		]) {
			await expect(
				(async () => (handler as (event: never) => unknown)(event as never))()
			).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
		}
	}
});
