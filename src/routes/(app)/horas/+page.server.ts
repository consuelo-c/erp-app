import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { POLICIES } from '$lib/roles';
import { hasAnyRole, requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { clearOwnDay, getOwnHours, saveOwnPunch } from '$lib/server/services/timesheets';
import type { Actions, PageServerLoad } from './$types';

// One screen: the punches of the day tapped in the week (`?dia=`, today by default) above that
// day's week, or the week `?semana=` names. A future or malformed day is a 404. ADMIN and MANAGER
// open Horas on Empleado, where they pick anyone, themselves included.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.anyLogin);
	if (hasAnyRole(locals.user, POLICIES.everyonesHours)) {
		redirect(303, resolve('/(app)/horas/empleado'));
	}
	const db = getDb(platform);
	const today = getTodaysDate();
	const input = {
		date: url.searchParams.get('dia') ?? today,
		week: url.searchParams.get('semana')
	};
	const hours = await getOwnHours(db, input, locals.user);
	if (null !== hours && 'missing' in hours) {
		error(404, 'Ese día no existe');
	}
	return { today, hours };
};

export const actions: Actions = {
	// The time dialog: one punch of the actor's own day.
	marcar: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.anyLogin);
		const db = getDb(platform);
		const input = Object.fromEntries(await request.formData());
		const result = await saveOwnPunch(db, input, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		return { saved: true };
	},
	// «Borrar marcas del día»: the four punches of that day back to empty.
	borrar: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.anyLogin);
		const db = getDb(platform);
		const input = Object.fromEntries(await request.formData());
		const result = await clearOwnDay(db, input, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		return { cleared: true };
	}
};
