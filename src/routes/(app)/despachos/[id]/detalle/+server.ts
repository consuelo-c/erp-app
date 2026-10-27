import { error, json } from '@sveltejs/kit';
import { isAdminOrManager, requireRole, ROLES } from '$lib/server/actor';
import { listIncidents } from '$lib/server/services/incidents';
import { getOrderDetail } from '$lib/server/services/orders';
import type { RequestHandler } from './$types';

// The operational detail as JSON, for its universal load: the whole order, prices included, for
// every role. ADMIN and MANAGER also learn whether it has incidents, active or reversed, to reach
// them in the order's «Novedades».
export const GET: RequestHandler = async ({ locals, params, platform }) => {
	requireRole(locals.user, ROLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const order = await getOrderDetail(db, params.id, locals.user);
	if (null === order) {
		error(404, 'Ese pedido no existe');
	}
	const hasIncidents =
		isAdminOrManager(locals.user) && 0 < (await listIncidents(db, order.id, locals.user)).length;
	return json({ order, hasIncidents });
};
