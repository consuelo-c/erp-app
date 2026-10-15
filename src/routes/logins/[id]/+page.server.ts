import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { deactivateLogin, reactivateLogin, updateRoles } from '$lib/server/services/logins';
import type { Actions } from './$types';

// The login itself is loaded by +layout.server.ts.
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
	},
	deactivate: async ({ locals, platform, params }) => {
		requireRole(locals.user, ['ADMIN']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const result = await deactivateLogin(platform.env.DB, { id: params.id }, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		redirect(303, resolve('/logins'));
	},
	reactivate: async ({ locals, platform, params }) => {
		requireRole(locals.user, ['ADMIN']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const result = await reactivateLogin(platform.env.DB, { id: params.id }, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		redirect(303, resolve('/logins'));
	}
};
