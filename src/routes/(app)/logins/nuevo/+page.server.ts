import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { createLogin, listEmployeesWithoutLogin } from '$lib/server/services/logins';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ['ADMIN']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return { employees: await listEmployeesWithoutLogin(platform.env.DB, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const formData = await request.formData();
		// The password never comes back to the form.
		const values = {
			username: String(formData.get('username') ?? ''),
			roles: formData.getAll('roles').map(String),
			employee_id: String(formData.get('employee_id') ?? '')
		};
		const input = { ...values, password: formData.get('password') };
		const env = { db: platform.env.DB, pepper: platform.env.PASSWORD_PEPPER };
		const result = await createLogin(env, input, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, values });
		}
		redirect(303, resolve('/logins'));
	}
};
