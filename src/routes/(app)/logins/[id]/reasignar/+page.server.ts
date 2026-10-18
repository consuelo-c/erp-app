import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { listEmployeesWithoutLogin, reassignLogin } from '$lib/server/services/logins';
import type { Actions, PageServerLoad } from './$types';

// The login is loaded by ../+layout.server.ts; this adds who it can pass to.
export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ['ADMIN']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return { employees: await listEmployeesWithoutLogin(platform.env.DB, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request, params }) => {
		requireRole(locals.user, ['ADMIN']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const formData = await request.formData();
		const input = {
			id: params.id,
			employee_id: formData.get('employee_id'),
			password: formData.get('password')
		};
		const env = { db: platform.env.DB, pepper: platform.env.PASSWORD_PEPPER };
		const result = await reassignLogin(env, input, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		redirect(303, `${resolve('/logins')}?aviso=reasignado`);
	}
};
