import { error, fail } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { approveCount, getCount, rejectCount, reverseCount } from '$lib/server/services/inventory';
import type { Actions, PageServerLoad } from './$types';

const REVIEWS = ['ADMIN', 'MANAGER'] as const;

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, REVIEWS);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const count = await getCount(platform.env.DB, params.id, locals.user);
	if (null === count) {
		error(404, 'Ese conteo no existe');
	}
	return { count };
};

export const actions: Actions = {
	aprobar: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, REVIEWS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { note } = Object.fromEntries(await request.formData());
		const result = await approveCount(platform.env.DB, { id: params.id, note }, locals.user);
		return result.ok ? { approved: true } : fail(400, { approveMessage: result.message });
	},
	rechazar: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, REVIEWS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { note } = Object.fromEntries(await request.formData());
		const result = await rejectCount(platform.env.DB, { id: params.id, note }, locals.user);
		return result.ok ? { rejected: true } : fail(400, { rejectMessage: result.message });
	},
	revertir: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, REVIEWS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { reason } = Object.fromEntries(await request.formData());
		const result = await reverseCount(platform.env.DB, { id: params.id, reason }, locals.user);
		if (result.ok) {
			return { reversed: true };
		}
		return fail(400, { reverseMessage: result.errors.reason ?? result.message });
	}
};
