import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { isAdminOrManager, requireRole } from '$lib/server/actor';
import { createContact } from '$lib/server/services/contacts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	return { isManager: isAdminOrManager(locals.user) };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const formData = await request.formData();
		// Services are checkboxes: one entry per service picked.
		const values = { ...Object.fromEntries(formData), services: formData.getAll('services') };
		const result = await createContact(platform.env.DB, values, locals.user);
		if (!result.ok) {
			return fail(400, { ...result, values });
		}
		// The list shows the saved notice for this flag.
		redirect(303, `${resolve('/contactos')}?guardado`);
	}
};
