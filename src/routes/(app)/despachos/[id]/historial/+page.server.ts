import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getOrderTimeline } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The order's events as each role sees them: the warehouse and the driver, only status changes.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.anyLogin);
	const db = getDb(platform);
	const entries = await getOrderTimeline(db, params.id, locals.user);
	if (null === entries) {
		error(404, 'Ese pedido no existe');
	}
	return { orderId: Number(params.id), entries };
};
