import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { getOrderFormOptions } from '$lib/server/services/orders';
import { convertQuote, getQuoteConversion } from '$lib/server/services/quotes';
import { readPostedJson } from '../order-form';
import type { Actions, PageServerLoad } from './$types';

const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;

// An order is born only from a quote: `?cotizacion=12` is «Convertir en pedido», the form filled
// from quote #12, and nothing is written until «Guardar pedido». No quote, an unknown one, or one
// that's expired or converted shows why, and no form.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, TAKES_ORDERS);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const quoteId = url.searchParams.get('cotizacion');
	if (null === quoteId) {
		return { refusal: 'Un pedido se crea al convertir una cotización.', quoteId: null };
	}
	const conversion = await getQuoteConversion(db, quoteId, locals.user);
	if (null === conversion) {
		return { refusal: 'Esa cotización no existe.', quoteId: null };
	}
	const { id, state } = conversion.quote;
	if ('CONVERTED' === state) {
		return { refusal: `La cotización #${id} ya se convirtió en pedido.`, quoteId: id };
	}
	if ('EXPIRED' === state) {
		const refusal = `La cotización #${id} está vencida: edítala con una nueva fecha de vigencia para convertirla.`;
		return { refusal, quoteId: id };
	}
	const options = await getOrderFormOptions(db, locals.user);
	return { refusal: null, options, conversion };
};

export const actions: Actions = {
	default: async ({ locals, platform, request, url }) => {
		requireRole(locals.user, TAKES_ORDERS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const formData = await request.formData();
		const order = readPostedJson(formData, 'order');
		const force = '1' === formData.get('force');
		const quote = url.searchParams.get('cotizacion');
		const result = await convertQuote(platform.env.DB, { quote, order, force }, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		// To the new order's detail, with the saved notice and the new order's reminder that its
		// amounts aren't payments: they're recorded from there.
		redirect(303, `${resolve('/(app)/pedidos/[id]', { id: String(result.id) })}?guardado=nuevo`);
	}
};
