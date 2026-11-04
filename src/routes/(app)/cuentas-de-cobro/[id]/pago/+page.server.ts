import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { requireRole } from '$lib/server/actor';
import { getReceivableDetail, recordReceivablePayment } from '$lib/server/services/receivables';
import type { Actions, PageServerLoad } from './$types';

const MANAGES_RECEIVABLES = ['ADMIN', 'MANAGER'] as const;

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, MANAGES_RECEIVABLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const receivable = await getReceivableDetail(platform.env.DB, params.id, locals.user);
	if (null === receivable) {
		error(404, 'Esa cuenta de cobro no existe');
	}
	return { receivable, today: getTodaysDate() };
};

export const actions: Actions = {
	// Saved, the cuenta shows the new payment and its receipt.
	default: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, MANAGES_RECEIVABLES);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = { ...Object.fromEntries(await request.formData()), id: params.id };
		const result = await recordReceivablePayment(platform.env.DB, values, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, errors: result.errors });
		}
		const query = new URLSearchParams({ pago: String(result.id) });
		redirect(303, `${resolve('/(app)/cuentas-de-cobro/[id]', { id: params.id })}?${query}`);
	}
};
