import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { createProduct, listVariantGroups } from '$lib/server/services/products';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.manageProducts);
	const db = getDb(platform);
	return { groups: await listVariantGroups(db, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.manageProducts);
		const db = getDb(platform);
		const values = Object.fromEntries(await request.formData());
		const result = await createProduct(db, values, locals.user);
		if (!result.ok) {
			return fail(400, { ...result, values });
		}
		// Back to the list, with the saved notice.
		redirect(303, `${resolve('/productos')}?guardado`);
	}
};
