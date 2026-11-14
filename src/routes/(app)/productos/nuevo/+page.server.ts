import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole } from '$lib/server/actor';
import { createProduct, listVariantGroups } from '$lib/server/services/products';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return { groups: await listVariantGroups(platform.env.DB, locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		const result = await createProduct(platform.env.DB, values, locals.user);
		if (!result.ok) {
			return fail(400, { ...result, values });
		}
		// Back to the list, with the saved notice.
		redirect(303, `${resolve('/productos')}?guardado`);
	}
};
