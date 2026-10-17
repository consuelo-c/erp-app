import { error, fail } from '@sveltejs/kit';
import { getTodaysDate } from '$lib/datetime';
import { requireRole, ROLES } from '$lib/server/actor';
import { getOwnHours, saveOwnPunch } from '$lib/server/services/timesheets';
import type { Actions, PageServerLoad } from './$types';

// One screen: the punches of the day tapped in the week (`?dia=`, today by default) above that
// day's week, or the week `?semana=` names. A future or malformed day is a 404.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ROLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const today = getTodaysDate();
	const input = {
		date: url.searchParams.get('dia') ?? today,
		week: url.searchParams.get('semana')
	};
	return { today, hours: await getOwnHours(platform.env.DB, input, locals.user) };
};

export const actions: Actions = {
	// The time dialog: one punch of the actor's own day.
	marcar: async ({ locals, platform, request }) => {
		requireRole(locals.user, ROLES);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const input = Object.fromEntries(await request.formData());
		const result = await saveOwnPunch(platform.env.DB, input, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		return { saved: true };
	}
};
