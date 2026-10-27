import { error, fail } from '@sveltejs/kit';
import { requireRole, ROLES } from '$lib/server/actor';
import { advanceOrder } from '$lib/server/services/orders';
import type { Actions } from './$types';

// Only the action: the detail itself loads in the browser (+page.ts), so it opens with no network.
export const actions: Actions = {
	// The status button: the next operational status and the direction's note, open to every role.
	avanzar: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, ROLES);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { status, notes } = Object.fromEntries(await request.formData());
		const input = { id: params.id, status, notes };
		const result = await advanceOrder(platform.env.DB, input, locals.user);
		return result.ok ? { advanced: true } : fail(400, { advanceMessage: result.message });
	}
};
