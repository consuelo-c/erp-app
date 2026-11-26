import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getOffsetOriginal, recordMovement, recordOffset } from '$lib/server/services/cash';
import { listPeopleWithTab } from '$lib/server/services/cash-handovers';
import type { Actions, PageServerLoad } from './$types';

// «Pagado por» lists who holds cash, with how much. `?corrige=` opens the tab as that movement's offsetting movement, pre-filled from it.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.managesCash);
	const db = getDb(platform);
	const correctedId = url.searchParams.get('corrige');
	return {
		today: getTodaysDate(),
		people: await listPeopleWithTab(db, locals.user),
		original: null === correctedId ? null : await getOffsetOriginal(db, correctedId, locals.user)
	};
};

export const actions: Actions = {
	// Saved, the new movement's detail opens over the book, its receipt the primary action.
	default: async ({ locals, platform, request, url }) => {
		requireRole(locals.user, POLICIES.managesCash);
		const db = getDb(platform);
		const values = Object.fromEntries(await request.formData());
		const correctedId = url.searchParams.get('corrige');
		const result =
			null === correctedId
				? await recordMovement(db, values, locals.user)
				: await recordOffset(db, { ...values, reverses_id: correctedId }, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, errors: result.errors });
		}
		const query = new URLSearchParams({ movimiento: String(result.id), aviso: 'registrado' });
		redirect(303, `${resolve('/(app)/caja')}?${query}`);
	}
};
