import { error } from '@sveltejs/kit';
import { requireRole, ROLES } from '$lib/server/actor';
import { getOrderDetail } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The operational detail: the whole order, prices included, for every role.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, ROLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const order = await getOrderDetail(platform.env.DB, params.id, locals.user);
	if (null === order) {
		error(404, 'Ese pedido no existe');
	}
	return { order };
};
