import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getReceivableEditForm, updateReceivable } from '$lib/server/services/receivables';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.receivables);
	const db = getDb(platform);
	const receivable = await getReceivableEditForm(db, params.id, locals.user);
	if (null === receivable) {
		error(404, 'Esa cuenta de cobro no existe');
	}
	return { receivable };
};

export const actions: Actions = {
	default: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, POLICIES.receivables);
		const db = getDb(platform);
		const posted = await request.formData();
		const input = {
			id: params.id,
			orders: posted.getAll('orders'),
			payment_terms: posted.get('payment_terms')
		};
		const result = await updateReceivable(db, input, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		redirect(303, resolve('/(app)/cuentas-de-cobro/[id]', { id: params.id }));
	}
};
