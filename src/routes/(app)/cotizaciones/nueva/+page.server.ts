import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { createQuote, getQuoteFormOptions } from '$lib/server/services/quotes';
import { readPostedJson } from '../../pedidos/order-form';
import type { Actions, PageServerLoad } from './$types';

const TAKES_QUOTES = ['ADMIN', 'MANAGER', 'SALES'] as const;

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, TAKES_QUOTES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return { options: await getQuoteFormOptions(platform.env.DB, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, TAKES_QUOTES);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const quote = readPostedJson(await request.formData(), 'quote');
		const result = await createQuote(platform.env.DB, quote, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		redirect(303, `${resolve('/(app)/cotizaciones/[id]', { id: String(result.id) })}?guardado`);
	}
};
