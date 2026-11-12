import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import {
	createQuote,
	getOrderRequote,
	getQuoteDuplicate,
	getQuoteFormOptions
} from '$lib/server/services/quotes';
import { readPostedJson } from '../../pedidos/order-form';
import type { Actions, PageServerLoad } from './$types';

const TAKES_QUOTES = ['ADMIN', 'MANAGER', 'SALES'] as const;

// `?desde=12` is «Duplicar», from quote #12; `?pedido=1060` is «Cotizar de nuevo», from order #1060.
// The form opens filled, and nothing is written until saved.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, TAKES_QUOTES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const options = await getQuoteFormOptions(db, locals.user);
	const from = url.searchParams.get('desde');
	const order = url.searchParams.get('pedido');
	if (null !== order) {
		const copy = await getOrderRequote(db, order, locals.user);
		if (null === copy) {
			error(404, 'Ese pedido no existe');
		}
		return { options, copy };
	}
	if (null === from) {
		return { options, copy: null };
	}
	const copy = await getQuoteDuplicate(db, from, locals.user);
	if (null === copy) {
		error(404, 'Esa cotización no existe');
	}
	return { options, copy };
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
