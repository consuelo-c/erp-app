import { error, fail } from '@sveltejs/kit';
import { isAdminOrManager, requireRole, ROLES } from '$lib/server/actor';
import { listIncidents } from '$lib/server/services/incidents';
import { advanceOrder, getOrderDetail } from '$lib/server/services/orders';
import type { Actions, PageServerLoad } from './$types';

// The operational detail: the whole order, prices included, for every role. ADMIN and MANAGER also
// learn whether it has incidents, active or reversed, to reach them in the order's «Novedades».
export const load: PageServerLoad = async ({ locals, params, platform }) => {
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
	return { order, hasIncidents };
};

export const actions: Actions = {
	// The status button: the next operational status and the direction's note, open to every role.
	avanzar: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, ROLES);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { status, notes } = Object.fromEntries(await request.formData());
		const input = { id: params.id, status, notes };
		const result = await advanceOrder(platform.env.DB, input, locals.user);
		return result.ok ? { advanced: true } : fail(400, { advanceMessage: result.message });
	}
};
