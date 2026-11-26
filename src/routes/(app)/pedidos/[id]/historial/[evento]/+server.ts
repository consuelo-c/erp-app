import { error, json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getOrderChange } from '$lib/server/services/orders';
import type { RequestHandler } from './$types';

// The timeline asks for an edit's changes when its row opens: the list never carries them.
export const GET: RequestHandler = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.orders);
	const db = getDb(platform);
	const input = { order: params.id, event: params.evento };
	const changes = await getOrderChange(db, input, locals.user);
	if (null === changes) {
		error(404, 'Esa edición no existe');
	}
	return json(changes);
};
