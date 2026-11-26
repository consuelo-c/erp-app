import { error, fail } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { reverseIncident } from '$lib/server/services/incidents';
import { advanceOrder } from '$lib/server/services/orders';
import type { Actions } from './$types';

// Only the actions: the detail itself loads in the browser (+page.ts), so it opens with no network.
export const actions: Actions = {
	// The status button: the next operational status and the direction's note, open to every role.
	avanzar: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, POLICIES.anyLogin);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { status, notes } = Object.fromEntries(await request.formData());
		const input = { id: params.id, status, notes };
		const result = await advanceOrder(platform.env.DB, input, locals.user);
		return result.ok ? { advanced: true } : fail(400, { advanceMessage: result.message });
	},
	// «Novedades»' reversal: its reporter until it's frozen, the manager on any. The service decides.
	revertir: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.anyLogin);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { id, reason } = Object.fromEntries(await request.formData());
		const result = await reverseIncident(platform.env.DB, { id, reason }, locals.user);
		if (result.ok) {
			return { reversed: true };
		}
		return fail(400, { reverseMessage: result.errors.reason ?? result.message });
	}
};
