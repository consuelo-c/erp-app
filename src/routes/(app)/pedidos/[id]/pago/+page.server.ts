import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { requireRole } from '$lib/server/actor';
import {
	getOrderDetail,
	getPaymentOptions,
	offeredPaymentConcepts,
	previewConfirmation,
	recordOrderPayment
} from '$lib/server/services/orders';
import type { Actions, PageServerLoad } from './$types';

const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;

// The payment entry: the order's balances for the confirmation's warnings, the accounts Cuenta de
// destino is pre-filled from, and its concepts. With none to offer, back to the order. On a draft,
// what confirming it would warn about: money in confirms it.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, TAKES_ORDERS);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const order = await getOrderDetail(db, params.id, locals.user);
	if (null === order) {
		error(404, 'Ese pedido no existe');
	}
	const concepts = offeredPaymentConcepts(order, locals.user);
	if (0 === concepts.length) {
		redirect(303, resolve('/(app)/pedidos/[id]', { id: params.id }));
	}
	const confirmation =
		'DRAFT' === order.status ? await previewConfirmation(db, { id: order.id }, locals.user) : null;
	return {
		order,
		concepts,
		shortages: confirmation?.shortages ?? [],
		options: await getPaymentOptions(db, order, locals.user),
		today: getTodaysDate()
	};
};

export const actions: Actions = {
	// Saved, the order shows the new payment and offers its receipt.
	default: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, TAKES_ORDERS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = { ...Object.fromEntries(await request.formData()), order_id: params.id };
		const result = await recordOrderPayment(platform.env.DB, values, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, errors: result.errors });
		}
		const query = new URLSearchParams({ pago: String(result.id) });
		redirect(303, `${resolve('/(app)/pedidos/[id]', { id: params.id })}?${query}`);
	}
};
