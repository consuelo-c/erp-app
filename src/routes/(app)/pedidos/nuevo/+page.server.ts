import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { createOrder, getOrderFormOptions } from '$lib/server/services/orders';
import { convertQuote, getQuoteConversion } from '$lib/server/services/quotes';
import { readPostedJson } from '../order-form';
import type { Actions, PageServerLoad } from './$types';

const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;

// `?cotizacion=12` is «Convertir en pedido»: the form opens filled from quote #12, and nothing is
// written until «Guardar pedido». A converted quote goes back to its detail.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, TAKES_ORDERS);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const options = await getOrderFormOptions(db, locals.user);
	const quoteId = url.searchParams.get('cotizacion');
	if (null === quoteId) {
		return { options, conversion: null };
	}
	const conversion = await getQuoteConversion(db, quoteId, locals.user);
	if (null === conversion) {
		error(404, 'Esa cotización no existe');
	}
	if ('CONVERTED' === conversion.quote.state) {
		redirect(303, resolve('/(app)/cotizaciones/[id]', { id: String(conversion.quote.id) }));
	}
	return { options, conversion };
};

export const actions: Actions = {
	default: async ({ locals, platform, request, url }) => {
		requireRole(locals.user, TAKES_ORDERS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const db = platform.env.DB;
		const order = readPostedJson(await request.formData(), 'order');
		const quoteId = url.searchParams.get('cotizacion');
		const result =
			null === quoteId
				? await createOrder(db, order, locals.user)
				: await convertQuote(db, { quote: quoteId, order }, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		// To the new order's detail, with the saved notice: its payments are recorded from there.
		redirect(303, `${resolve('/(app)/pedidos/[id]', { id: String(result.id) })}?guardado`);
	}
};
