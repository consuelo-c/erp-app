import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { requireRole } from '$lib/server/actor';
import { createEmployee } from '$lib/server/services/employees';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	return { today: getTodaysDate() };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		const result = await createEmployee(platform.env.DB, values, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, values });
		}
		// The list shows the saved notice for this flag.
		redirect(303, `${resolve('/personal')}?guardado`);
	}
};
