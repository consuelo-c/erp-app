import { error } from '@sveltejs/kit';
import { requireRole, ROLES } from '$lib/server/actor';
import { getOrderPrintout } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The same half-letter sheets as Pedidos', for every role: the driver carries them.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, ROLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const printout = await getOrderPrintout(platform.env.DB, params.id, locals.user);
	if (null === printout) {
		error(404, 'Ese pedido no existe');
	}
	return { printout };
};
