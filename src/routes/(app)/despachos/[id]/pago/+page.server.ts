import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { requireRole } from '$lib/server/actor';
import {
	getDespachosPaymentEntry,
	getOrderDetail,
	getPaymentOptions,
	RECORDS_PAYMENTS,
	recordOrderPayment
} from '$lib/server/services/orders';
import { listActiveIncidents } from '$lib/server/services/incidents';
import type { Actions, PageServerLoad } from './$types';

// Despachos' payment entry: what the order offers this login on the road now, and the client's
// account a refund by transfer is pre-filled from. With nothing to offer, back to the order.
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
	const entry = getDespachosPaymentEntry(order, locals.user);
	if (0 === entry.concepts.length) {
		redirect(303, `${resolve('/(app)/despachos/[id]', { id: params.id })}${url.search}`);
	}
	return {
		order,
		entry,
		options: await getPaymentOptions(db, order, locals.user),
		activeIncidents: order.hasIncident ? await listActiveIncidents(db, order.id, locals.user) : [],
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
