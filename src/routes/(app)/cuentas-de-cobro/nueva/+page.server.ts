import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getReceivableIssueForm, issueReceivable } from '$lib/server/services/receivables';
import type { Actions, PageServerLoad } from './$types';

// An order that can't start a cuenta de cobro gets a null form, which the screen reads as a message.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.receivables);
	const db = getDb(platform);
	const orderId = url.searchParams.get('pedido');
	return { receivable: await getReceivableIssueForm(db, orderId, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.receivables);
		const db = getDb(platform);
		const posted = await request.formData();
		const input = { orders: posted.getAll('orders'), payment_terms: posted.get('payment_terms') };
		const result = await issueReceivable(db, input, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		redirect(303, resolve('/(app)/cuentas-de-cobro/[id]', { id: String(result.id) }));
	}
};
