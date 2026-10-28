import { error, fail } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getHelp, updateHelp } from '$lib/server/services/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const { text } = await getHelp(platform.env.DB, locals.user);
	return { text };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		const result = await updateHelp(platform.env.DB, values, locals.user);
		return result.ok
			? { saved: true }
			: fail(400, { message: result.message, text: String(values.text ?? '') });
	}
};
