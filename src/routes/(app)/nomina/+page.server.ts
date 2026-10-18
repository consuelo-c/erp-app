import { error, fail } from '@sveltejs/kit';
import { getTodaysDate } from '$lib/datetime';
import { requireRole } from '$lib/server/actor';
import { openWeek, saveDraft } from '$lib/server/services/payroll';
import type { Actions, PageServerLoad } from './$types';

// One employee's settlement for one week: `?empleado=` (the first one by default) and `?semana=`,
// any date of the week (this one by default).
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = {
		employeeId: url.searchParams.get('empleado'),
		week: url.searchParams.get('semana')
	};
	return {
		today: getTodaysDate(),
		week: await openWeek(platform.env.DB, input, locals.user)
	};
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		const result = await saveDraft(platform.env.DB, values, locals.user);
		return result.ok
			? { saved: true }
			: fail(400, { message: result.message, errors: result.errors, values });
	}
};
