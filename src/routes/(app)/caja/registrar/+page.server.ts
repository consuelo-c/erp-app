import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { requireRole } from '$lib/server/actor';
import { getOffsetOriginal, recordMovement, recordOffset } from '$lib/server/services/cash';
import type { Actions, PageServerLoad } from './$types';

// `?corrige=` opens the tab as that movement's offsetting movement, pre-filled from it.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const correctedId = url.searchParams.get('corrige');
	return {
		today: getTodaysDate(),
		original:
			null === correctedId
				? null
				: await getOffsetOriginal(platform.env.DB, correctedId, locals.user)
	};
};

export const actions: Actions = {
	// Saved, the new movement's detail opens over the book, its receipt the primary action.
	default: async ({ locals, platform, request, url }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		const correctedId = url.searchParams.get('corrige');
		const result =
			null === correctedId
				? await recordMovement(platform.env.DB, values, locals.user)
				: await recordOffset(platform.env.DB, { ...values, reverses_id: correctedId }, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, errors: result.errors });
		}
		const query = new URLSearchParams({ movimiento: String(result.id), aviso: 'registrado' });
		redirect(303, `${resolve('/(app)/caja')}?${query}`);
	}
};
