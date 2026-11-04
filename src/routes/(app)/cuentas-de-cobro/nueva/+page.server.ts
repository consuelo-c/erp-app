import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { getReceivableIssueForm, issueReceivable } from '$lib/server/services/receivables';
import type { Actions, PageServerLoad } from './$types';

const MANAGES_RECEIVABLES = ['ADMIN', 'MANAGER'] as const;

// An order that can't start a cuenta de cobro gets a null form, which the screen reads as a message.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, MANAGES_RECEIVABLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const orderId = url.searchParams.get('pedido');
	return { receivable: await getReceivableIssueForm(platform.env.DB, orderId, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, MANAGES_RECEIVABLES);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const posted = await request.formData();
		const input = { orders: posted.getAll('orders'), payment_terms: posted.get('payment_terms') };
		const result = await issueReceivable(platform.env.DB, input, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		redirect(303, resolve('/(app)/cuentas-de-cobro/[id]', { id: String(result.id) }));
	}
};
