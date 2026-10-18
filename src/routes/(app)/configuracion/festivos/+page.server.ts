import { error, fail } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getHolidays, overrideFrozenHoliday, updateHolidays } from '$lib/server/services/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return await getHolidays(platform.env.DB, locals.user);
};

export const actions: Actions = {
	// «Guardar festivos»: the dates after the freeze line.
	guardar: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		const result = await updateHolidays(platform.env.DB, values, locals.user);
		return result.ok ? { saved: true } : fail(400, { message: result.message });
	},
	// «Modificar fecha cerrada»: ADMIN's change to one date on or before it, with its reason.
	modificar: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		const result = await overrideFrozenHoliday(platform.env.DB, values, locals.user);
		return result.ok ? { saved: true } : fail(400, { overrideMessage: result.message });
	}
};
