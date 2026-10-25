import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { createExtension, getOrderDetail, getOrderFormOptions } from '$lib/server/services/orders';
import { readPostedOrder } from '../../order-form';
import type { Actions, PageServerLoad } from './$types';

const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;

// Only a delivered order is extended: any other goes back to its detail.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, TAKES_ORDERS);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const [original, options] = await Promise.all([
		getOrderDetail(db, params.id, locals.user),
		getOrderFormOptions(db, locals.user)
	]);
	if (null === original) {
		error(404, 'Ese pedido no existe');
	}
	if ('DELIVERED' !== original.status) {
		redirect(303, resolve('/(app)/pedidos/[id]', { id: String(original.id) }));
	}
	return { original, options };
};

export const actions: Actions = {
	default: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, TAKES_ORDERS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const posted = readPostedOrder(await request.formData());
		const extension = { ...(posted as object), parent_order_id: params.id };
		const result = await createExtension(platform.env.DB, extension, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		redirect(303, `${resolve('/(app)/pedidos/[id]', { id: String(result.id) })}?guardado`);
	}
};
