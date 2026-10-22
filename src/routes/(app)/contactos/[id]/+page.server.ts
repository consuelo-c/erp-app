import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { isAdminOrManager, requireRole } from '$lib/server/actor';
import { getContact, updateContact } from '$lib/server/services/contacts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, params }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const contact = await getContact(platform.env.DB, Number(params.id), locals.user);
	if (null === contact) {
		error(404, 'Ese contacto no existe');
	}
	return { contact, isManager: isAdminOrManager(locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request, params }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const formData = await request.formData();
		// Services are checkboxes: one entry per service picked. The id always comes from the URL.
		const values = { ...Object.fromEntries(formData), services: formData.getAll('services') };
		const result = await updateContact(platform.env.DB, { ...values, id: params.id }, locals.user);
		if (!result.ok) {
			return fail(400, { ...result, values });
		}
		redirect(303, `${resolve('/contactos')}?guardado`);
	}
};
