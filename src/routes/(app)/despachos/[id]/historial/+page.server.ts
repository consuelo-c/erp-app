import { error } from '@sveltejs/kit';
import { requireRole, ROLES } from '$lib/server/actor';
import { getOrderTimeline } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The order's events as each role sees them: the warehouse and the driver, only status changes.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, ROLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const entries = await getOrderTimeline(platform.env.DB, params.id, locals.user);
	if (null === entries) {
		error(404, 'Ese pedido no existe');
	}
	return { orderId: Number(params.id), entries };
};
