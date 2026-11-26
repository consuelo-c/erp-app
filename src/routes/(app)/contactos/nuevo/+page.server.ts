import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { POLICIES } from '$lib/roles';
import { hasAnyRole, requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { createContact, listContactLabels } from '$lib/server/services/contacts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.contacts);
	const db = getDb(platform);
	const labels = await listContactLabels(db, locals.user);
	return { canEditLockedFields: hasAnyRole(locals.user, POLICIES.lockedContactFields), labels };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.contacts);
		const db = getDb(platform);
		const formData = await request.formData();
		// Etiquetas are checkboxes: one entry per etiqueta picked.
		const values = { ...Object.fromEntries(formData), labels: formData.getAll('labels') };
		const result = await createContact(db, values, locals.user);
		if (!result.ok) {
			return fail(400, { ...result, values });
		}
		// The list shows the saved notice for this flag.
		redirect(303, `${resolve('/contactos')}?guardado`);
	}
};
