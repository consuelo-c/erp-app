import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { getReceivableEditForm, updateReceivable } from '$lib/server/services/receivables';
import type { Actions, PageServerLoad } from './$types';

const MANAGES_RECEIVABLES = ['ADMIN', 'MANAGER'] as const;

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, MANAGES_RECEIVABLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const receivable = await getReceivableEditForm(platform.env.DB, params.id, locals.user);
	if (null === receivable) {
		error(404, 'Esa cuenta de cobro no existe');
	}
	return { receivable };
};

export const actions: Actions = {
	default: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, MANAGES_RECEIVABLES);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const posted = await request.formData();
		const input = {
			id: params.id,
			orders: posted.getAll('orders'),
			payment_terms: posted.get('payment_terms')
		};
		const result = await updateReceivable(platform.env.DB, input, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		redirect(303, resolve('/(app)/cuentas-de-cobro/[id]', { id: params.id }));
	}
};
