import { error, fail } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getSystemSettings, updateSystemSettings } from '$lib/server/services/settings';
import type { SettingModule } from '$lib/settings';
import type { Actions, PageServerLoad } from './$types';

// Nómina's tab: the values that calculate the payroll. The holidays have their own.
const MODULES: SettingModule[] = ['PAYROLL'];

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return { settings: await getSystemSettings(platform.env.DB, MODULES, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		const result = await updateSystemSettings(
			platform.env.DB,
			{ modules: MODULES, values },
			locals.user
		);
		return result.ok ? { saved: true } : fail(400, { errors: result.errors, values });
	}
};
