import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getLogin } from '$lib/server/services/logins';
import type { LayoutServerLoad } from './$types';

// The login every screen under /logins/[id] acts on: its detail, password and reassignment.
export const load: LayoutServerLoad = async ({ locals, platform, params }) => {
	requireRole(locals.user, ['ADMIN']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const login = await getLogin(platform.env.DB, Number(params.id), locals.user);
	if (null === login) {
		error(404, 'Ese login no existe');
	}
	return { login };
};
