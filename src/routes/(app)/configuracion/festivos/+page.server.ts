import { fail } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getHolidays, overrideFrozenHoliday, updateHolidays } from '$lib/server/services/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.settings);
	const db = getDb(platform);
	return getHolidays(db, locals.user);
};

export const actions: Actions = {
	// «Guardar festivos»: the dates after the freeze line.
	guardar: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.settings);
		const db = getDb(platform);
		const values = Object.fromEntries(await request.formData());
		const result = await updateHolidays(db, values, locals.user);
		return result.ok ? { saved: true } : fail(400, { message: result.message });
	},
	// «Modificar fecha cerrada»: ADMIN's change to one date on or before it, with its reason.
	modificar: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.overrideClosedDate);
		const db = getDb(platform);
		const values = Object.fromEntries(await request.formData());
		const result = await overrideFrozenHoliday(db, values, locals.user);
		return result.ok ? { saved: true } : fail(400, { overrideMessage: result.message });
	}
};
