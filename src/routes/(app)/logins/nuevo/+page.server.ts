import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb, getEnv } from '$lib/server/platform';
import { createLogin, listEmployeesWithoutLogin } from '$lib/server/services/logins';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.logins);
	const db = getDb(platform);
	return { employees: await listEmployeesWithoutLogin(db, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.logins);
		const { DB, PASSWORD_PEPPER } = getEnv(platform);
		const formData = await request.formData();
		// The password never comes back to the form.
		const values = {
			username: String(formData.get('username') ?? ''),
			roles: formData.getAll('roles').map(String),
			employee_id: String(formData.get('employee_id') ?? '')
		};
		const input = { ...values, password: formData.get('password') };
		const env = { db: DB, pepper: PASSWORD_PEPPER };
		const result = await createLogin(env, input, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, values });
		}
		redirect(303, `${resolve('/logins')}?aviso=creado`);
	}
};
