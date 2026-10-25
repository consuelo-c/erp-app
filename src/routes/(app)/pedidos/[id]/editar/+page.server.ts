import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { isEditableStatus } from '$lib/orders';
import { requireRole } from '$lib/server/actor';
import { getOrderDetail, getOrderFormOptions, updateOrder } from '$lib/server/services/orders';
import { readPostedOrder } from '../../order-form';
import type { Actions, PageServerLoad } from './$types';

const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;

// Once the products are on their way back the order is read-only: its detail, not the form.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, TAKES_ORDERS);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const [order, options] = await Promise.all([
		getOrderDetail(db, params.id, locals.user),
		getOrderFormOptions(db, locals.user)
	]);
	if (null === order) {
		error(404, 'Ese pedido no existe');
	}
	if (!isEditableStatus(order.status)) {
		redirect(303, resolve('/(app)/pedidos/[id]', { id: String(order.id) }));
	}
	return { order, options };
};

export const actions: Actions = {
	default: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, TAKES_ORDERS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const posted = readPostedOrder(await request.formData());
		const order = { ...(posted as object), id: params.id };
		const result = await updateOrder(platform.env.DB, order, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		redirect(303, `${resolve('/(app)/pedidos/[id]', { id: params.id })}?guardado`);
	}
};
