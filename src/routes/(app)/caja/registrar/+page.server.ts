import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { requireRole } from '$lib/server/actor';
import { recordMovement } from '$lib/server/services/cash';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	return { today: getTodaysDate() };
};

export const actions: Actions = {
	// Saved, the new movement's detail opens over the book, its receipt the primary action.
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		const result = await recordMovement(platform.env.DB, values, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, errors: result.errors });
		}
		const query = new URLSearchParams({ movimiento: String(result.id), aviso: 'registrado' });
		redirect(303, `${resolve('/(app)/caja')}?${query}`);
	}
};
