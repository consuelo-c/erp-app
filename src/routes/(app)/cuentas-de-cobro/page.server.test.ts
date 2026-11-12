import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import type { Actor, Role } from '$lib/server/actor';
import { load as loadCashBook } from '../caja/+page.server';
import { actions as cashEntryActions, load as loadCashEntry } from '../caja/registrar/+page.server';
import { load as loadList } from './+page.server';
import { load as loadDetail } from './[id]/+page.server';
import { actions as editActions, load as loadEdit } from './[id]/editar/+page.server';
import { load as loadPrintout } from './[id]/impresion/+page.server';
import { actions as paymentActions, load as loadPayment } from './[id]/pago/+page.server';
import { actions as issueActions, load as loadIssue } from './nueva/+page.server';

const HANDLERS = [
	loadList,
	loadDetail,
	loadIssue,
	loadEdit,
	loadPayment,
	loadPrintout,
	issueActions.default,
	editActions.default,
	paymentActions.default
];

// No database: a role that passes the check reaches the missing platform's 500.
function eventFor(role: Role) {
	const user: Actor = { username: 'ventas', employeeId: null, roles: [role], kind: 'user' };
	return {
		locals: { user },
		cookies: { get: () => undefined, set: () => {}, delete: () => {} },
		params: { id: '1' },
		url: new URL('https://erp.test/cuentas-de-cobro'),
		platform: undefined
	};
}

function run(handler: unknown, role: Role): Promise<unknown> {
	return (async () => (handler as (event: never) => unknown)(eventFor(role) as never))();
}

test('WAREHOUSE and DRIVER get the no-permission screen on every /cuentas-de-cobro route', async () => {
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		for (const handler of HANDLERS) {
			await expect(run(handler, role)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
		}
	}
});

test('SALES opens every /cuentas-de-cobro route, as MANAGER and ADMIN', async () => {
	for (const role of ['SALES', 'MANAGER', 'ADMIN'] satisfies Role[]) {
		for (const handler of HANDLERS) {
			await expect(run(handler, role)).rejects.toSatisfy((thrown) => isHttpError(thrown, 500));
		}
	}
});

test('SALES still gets the no-permission screen in Caja', async () => {
	for (const handler of [loadCashBook, loadCashEntry, cashEntryActions.default]) {
		await expect(run(handler, 'SALES')).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	}
});
