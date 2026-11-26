import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { createEmployee } from '$lib/server/services/employees';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals.user, POLICIES.employees);
	return { today: getTodaysDate() };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.employees);
		const db = getDb(platform);
		const values = Object.fromEntries(await request.formData());
		const result = await createEmployee(db, values, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, errors: result.errors, values });
		}
		// The list shows the saved notice for this flag.
		redirect(303, `${resolve('/personal')}?guardado`);
	}
};
