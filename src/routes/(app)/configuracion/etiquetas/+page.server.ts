import { fail, type RequestEvent } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import {
	createLabel,
	deleteLabel,
	listLabelRows,
	renameLabel,
	type LabelResult
} from '$lib/server/services/contacts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.contactLabels);
	const db = getDb(platform);
	return { labels: await listLabelRows(db, locals.user) };
};

type LabelWrite = typeof createLabel;

// Each action posts its form to its service; a refusal comes back under the field it was typed in.
function labelAction(action: string, write: LabelWrite) {
	return async ({ locals, platform, request }: RequestEvent) => {
		requireRole(locals.user, POLICIES.contactLabels);
		const db = getDb(platform);
		const values = Object.fromEntries(await request.formData());
		const result: LabelResult = await write(db, values, locals.user);
		return result.ok ? { saved: action } : fail(400, { action, message: result.message });
	};
}

export const actions: Actions = {
	crear: labelAction('crear', createLabel),
	renombrar: labelAction('renombrar', renameLabel),
	eliminar: labelAction('eliminar', deleteLabel)
};
