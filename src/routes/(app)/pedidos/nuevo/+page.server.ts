import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { createOrder, getOrderFormOptions } from '$lib/server/services/orders';
import { readPostedOrder } from '../order-form';
import type { Actions, PageServerLoad } from './$types';

const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, TAKES_ORDERS);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return { options: await getOrderFormOptions(platform.env.DB, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, TAKES_ORDERS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const order = readPostedOrder(await request.formData());
		const result = await createOrder(platform.env.DB, order, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		// To the new order's detail, with the saved notice: its payments are recorded from there.
		redirect(303, `${resolve('/(app)/pedidos/[id]', { id: String(result.id) })}?guardado`);
	}
};
