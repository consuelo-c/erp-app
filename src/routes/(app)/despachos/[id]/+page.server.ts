import { error, fail } from '@sveltejs/kit';
import { requireRole, ROLES } from '$lib/server/actor';
import { advanceOrder, getOrderDetail } from '$lib/server/services/orders';
import type { Actions, PageServerLoad } from './$types';

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

export const actions: Actions = {
	avanzar: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, ROLES);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { status, note } = Object.fromEntries(await request.formData());
		const input = { id: params.id, status, note };
		const result = await advanceOrder(platform.env.DB, input, locals.user);
		if (result.ok) {
			return { advanced: true };
		}
		return fail(400, { advanceMessage: result.errors.note ?? result.message });
	}
};
