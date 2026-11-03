import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { getQuote, getQuoteFormOptions, updateQuote } from '$lib/server/services/quotes';
import { readPostedJson } from '../../../pedidos/order-form';
import type { Actions, PageServerLoad } from './$types';

const TAKES_QUOTES = ['ADMIN', 'MANAGER', 'SALES'] as const;

// A converted quote is read-only: its detail, not the form.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, TAKES_QUOTES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const [quote, options] = await Promise.all([
		getQuote(db, params.id, locals.user),
		getQuoteFormOptions(db, locals.user)
	]);
	if (null === quote) {
		error(404, 'Esa cotización no existe');
	}
	if ('CONVERTED' === quote.state) {
		redirect(303, resolve('/(app)/cotizaciones/[id]', { id: String(quote.id) }));
	}
	return { quote, options };
};

export const actions: Actions = {
	default: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, TAKES_QUOTES);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const posted = readPostedJson(await request.formData(), 'quote');
		const quote = { ...(posted as object), id: params.id };
		const result = await updateQuote(platform.env.DB, quote, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		redirect(303, `${resolve('/(app)/cotizaciones/[id]', { id: params.id })}?guardado`);
	}
};
