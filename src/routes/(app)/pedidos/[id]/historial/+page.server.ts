import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getOrderTimeline } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The order's events, newest first; an edit's changes load when its row opens.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const entries = await getOrderTimeline(platform.env.DB, params.id, locals.user);
	if (null === entries) {
		error(404, 'Ese pedido no existe');
	}
	return { orderId: Number(params.id), entries };
};
