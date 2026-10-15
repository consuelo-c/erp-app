import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { getLogin, updateRoles } from '$lib/server/services/logins';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, params }) => {
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

export const actions: Actions = {
	roles: async ({ locals, platform, request, params }) => {
		requireRole(locals.user, ['ADMIN']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const roles = (await request.formData()).getAll('roles').map(String);
		const result = await updateRoles(platform.env.DB, { id: params.id, roles }, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, roles });
		}
		redirect(303, resolve('/logins'));
	}
};
