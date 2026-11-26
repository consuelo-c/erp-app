import { fail } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getTerms, updateTerms } from '$lib/server/services/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.settings);
	const db = getDb(platform);
	return { text: await getTerms(db, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.settings);
		const db = getDb(platform);
		const values = Object.fromEntries(await request.formData());
		const result = await updateTerms(db, values, locals.user);
		return result.ok
			? { saved: true }
			: fail(400, { message: result.message, text: String(values.text ?? '') });
	}
};
