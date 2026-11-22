import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { isAdminOrManager, requireRole } from '$lib/server/actor';
import {
	getOrderDetail,
	getPaymentOptions,
	offeredPaymentConcepts,
	recordOrderPayment
} from '$lib/server/services/orders';
import type { Actions, PageServerLoad } from './$types';

// The office and the driver; the warehouse doesn't handle money.
const RECORDS_PAYMENTS = ['ADMIN', 'MANAGER', 'SALES', 'DRIVER'] as const;

// Despachos' payment entry: what the order offers this login now, and the client's account a
// refund by transfer is pre-filled from. With nothing to offer, back to the order.
export const load: PageServerLoad = async ({ locals, params, platform, url }) => {
	requireRole(locals.user, RECORDS_PAYMENTS);
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
		redirect(303, `${resolve('/(app)/despachos/[id]', { id: params.id })}${url.search}`);
	}
	return {
		order,
		concepts,
		// A partial refund is the office's call: whoever isn't the manager gives the whole deposit back.
		isRefundWhole: !isAdminOrManager(locals.user),
		options: await getPaymentOptions(db, order, locals.user),
		today: getTodaysDate()
	};
};

export const actions: Actions = {
	// Saved, the order's detail says what was recorded, its receipt number and the new Saldo.
	default: async ({ locals, params, platform, request, url }) => {
		requireRole(locals.user, RECORDS_PAYMENTS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = { ...Object.fromEntries(await request.formData()), order_id: params.id };
		const result = await recordOrderPayment(platform.env.DB, values, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, errors: result.errors });
		}
		const query = new URLSearchParams(url.search);
		query.set('pago', String(result.id));
		redirect(303, `${resolve('/(app)/despachos/[id]', { id: params.id })}?${query}`);
	}
};
