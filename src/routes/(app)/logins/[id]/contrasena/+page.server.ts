import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { setPassword } from '$lib/server/services/logins';
import type { Actions } from './$types';

// The login is loaded by ../+layout.server.ts.
export const actions: Actions = {
	default: async ({ locals, platform, request, params }) => {
		requireRole(locals.user, ['ADMIN']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const password = (await request.formData()).get('password');
		const env = { db: platform.env.DB, pepper: platform.env.PASSWORD_PEPPER };
		const result = await setPassword(env, { id: params.id, password }, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		redirect(303, `${resolve('/logins')}?aviso=contrasena`);
	}
};
