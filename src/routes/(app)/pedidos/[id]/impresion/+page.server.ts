import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getOrderPrintout } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The order's printed half-letter sheets, printed from its detail.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const printout = await getOrderPrintout(platform.env.DB, params.id, locals.user);
	if (null === printout) {
		error(404, 'Ese pedido no existe');
	}
	return { printout };
};
