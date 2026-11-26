import { fail } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getSystemSettings, updateSystemSettings } from '$lib/server/services/settings';
import type { SettingModule } from '$lib/settings';
import type { Actions, PageServerLoad } from './$types';

// General's modules; payroll's are Nómina's tab.
const MODULES: SettingModule[] = ['COMPANY', 'QUOTES'];

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.settings);
	const db = getDb(platform);
	return { settings: await getSystemSettings(db, MODULES, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.settings);
		const db = getDb(platform);
		const values = Object.fromEntries(await request.formData());
		const result = await updateSystemSettings(db, { modules: MODULES, values }, locals.user);
		return result.ok ? { saved: true } : fail(400, { errors: result.errors, values });
	}
};
