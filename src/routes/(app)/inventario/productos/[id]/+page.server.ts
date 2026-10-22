import { error, fail, redirect } from '@sveltejs/kit';
import { catalogHref } from '$lib/navigation';
import { requireRole } from '$lib/server/actor';
import { getProduct, listVariantGroups, updateProduct } from '$lib/server/services/products';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, params }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const [product, groups] = await Promise.all([
		getProduct(platform.env.DB, Number(params.id), locals.user),
		listVariantGroups(platform.env.DB, locals.user)
	]);
	if (null === product) {
		error(404, 'Ese producto no existe');
	}
	return { product, groups };
};

export const actions: Actions = {
	default: async ({ locals, platform, request, params }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		// The id always comes from the URL.
		const result = await updateProduct(platform.env.DB, { ...values, id: params.id }, locals.user);
		if (!result.ok) {
			return fail(400, { ...result, values });
		}
		redirect(303, catalogHref(result.variantGroup, { guardado: '' }));
	}
};
