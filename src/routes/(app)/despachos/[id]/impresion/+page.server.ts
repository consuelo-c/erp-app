import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getOrderPrintout } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The same half-letter sheets as Pedidos', for every role: the driver carries them.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.anyLogin);
	const db = getDb(platform);
	const printout = await getOrderPrintout(db, params.id, locals.user);
	if (null === printout) {
		error(404, 'Ese pedido no existe');
	}
	return { printout };
};
