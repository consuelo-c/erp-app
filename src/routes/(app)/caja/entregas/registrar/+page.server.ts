import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { listPeopleWithTab, recordHandover } from '$lib/server/services/cash-handovers';
import type { Actions, PageServerLoad } from './$types';

// `?persona=` pre-selects «Entregó»: the person whose tab the manager was reading.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.managesCash);
	const db = getDb(platform);
	return {
		today: getTodaysDate(),
		people: await listPeopleWithTab(db, locals.user),
		chosen: url.searchParams.get('persona')
	};
};

export const actions: Actions = {
	// Saved, the person's tab opens on the handover's day, where it's listed.
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.managesCash);
		const db = getDb(platform);
		const values = Object.fromEntries(await request.formData());
		const result = await recordHandover(db, values, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, errors: result.errors });
		}
		const day = String(values.handover_date);
		const query = new URLSearchParams({ persona: String(values.username), desde: day, hasta: day });
		redirect(303, `${resolve('/(app)/caja/entregas')}?${query}`);
	}
};
