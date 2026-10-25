import { error, json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getOrderChange } from '$lib/server/services/orders';
import type { RequestHandler } from './$types';

// The timeline asks for an edit's changes when its row opens: the list never carries them.
export const GET: RequestHandler = async ({ locals, params, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = { order: params.id, event: params.evento };
	const changes = await getOrderChange(platform.env.DB, input, locals.user);
	if (null === changes) {
		error(404, 'Esa edición no existe');
	}
	return json(changes);
};
