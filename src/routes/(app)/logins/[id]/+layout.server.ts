import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getLogin } from '$lib/server/services/logins';
import type { LayoutServerLoad } from './$types';

// The login every screen under /logins/[id] acts on: its detail, password and reassignment.
export const load: LayoutServerLoad = async ({ locals, platform, params }) => {
	requireRole(locals.user, POLICIES.logins);
	const db = getDb(platform);
	const login = await getLogin(db, Number(params.id), locals.user);
	if (null === login) {
		error(404, 'Ese login no existe');
	}
	return { login };
};
