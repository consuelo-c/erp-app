import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getEnv } from '$lib/server/platform';
import { setPassword } from '$lib/server/services/logins';
import type { Actions } from './$types';

// The login is loaded by ../+layout.server.ts.
export const actions: Actions = {
	default: async ({ locals, platform, request, params }) => {
		requireRole(locals.user, POLICIES.logins);
		const { DB, PASSWORD_PEPPER } = getEnv(platform);
		const password = (await request.formData()).get('password');
		const env = { db: DB, pepper: PASSWORD_PEPPER };
		const result = await setPassword(env, { id: params.id, password }, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, errors: result.errors });
		}
		redirect(303, `${resolve('/logins')}?aviso=contrasena`);
	}
};
