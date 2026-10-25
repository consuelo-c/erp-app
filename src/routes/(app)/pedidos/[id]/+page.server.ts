import { error, fail } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import {
	cancelOrder,
	confirmOrder,
	getOrderDetail,
	previewConfirmation
} from '$lib/server/services/orders';
import type { Actions, PageServerLoad } from './$types';

const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;

// A draft brings what its «Confirmar» dialog shows: the suggested advance and any shortage.
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
	const isDraft = 'DRAFT' === order.status;
	const confirmation = isDraft
		? await previewConfirmation(db, { id: order.id }, locals.user)
		: null;
	return { order, confirmation };
};

export const actions: Actions = {
	confirmar: async ({ locals, params, platform }) => {
		requireRole(locals.user, TAKES_ORDERS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const result = await confirmOrder(platform.env.DB, { id: params.id }, locals.user);
		return result.ok ? { confirmed: true } : fail(400, { confirmMessage: result.message });
	},
	cancelar: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, TAKES_ORDERS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { reason } = Object.fromEntries(await request.formData());
		const input = { id: params.id, reason };
		const result = await cancelOrder(platform.env.DB, input, locals.user);
		if (result.ok) {
			return { cancelled: true };
		}
		return fail(400, { cancelMessage: result.errors.reason ?? result.message });
	}
};
