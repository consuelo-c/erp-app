import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { deactivateLogin, reactivateLogin, updateRoles } from '$lib/server/services/logins';
import type { Actions } from './$types';

// The login itself is loaded by +layout.server.ts. `?aviso=` picks the list's success notice.
export const actions: Actions = {
	roles: async ({ locals, platform, request, params }) => {
		requireRole(locals.user, POLICIES.logins);
		const db = getDb(platform);
		const roles = (await request.formData()).getAll('roles').map(String);
		const result = await updateRoles(db, { id: params.id, roles }, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, roles });
		}
		redirect(303, `${resolve('/logins')}?aviso=actualizado`);
	},
	deactivate: async ({ locals, platform, params }) => {
		requireRole(locals.user, POLICIES.logins);
		const db = getDb(platform);
		const result = await deactivateLogin(db, { id: params.id }, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		redirect(303, `${resolve('/logins')}?aviso=desactivado`);
	},
	reactivate: async ({ locals, platform, params }) => {
		requireRole(locals.user, POLICIES.logins);
		const db = getDb(platform);
		const result = await reactivateLogin(db, { id: params.id }, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		redirect(303, `${resolve('/logins')}?aviso=reactivado`);
	}
};
