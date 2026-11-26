import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getOrderTimeline } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The order's events, newest first; an edit's changes load when its row opens.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.orders);
	const db = getDb(platform);
	const entries = await getOrderTimeline(db, params.id, locals.user);
	if (null === entries) {
		error(404, 'Ese pedido no existe');
	}
	return { orderId: Number(params.id), entries };
};
