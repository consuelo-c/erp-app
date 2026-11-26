import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getOrderPrintout } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The order's printed half-letter sheets, printed from its detail.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.orders);
	const db = getDb(platform);
	const printout = await getOrderPrintout(db, params.id, locals.user);
	if (null === printout) {
		error(404, 'Ese pedido no existe');
	}
	return { printout };
};
