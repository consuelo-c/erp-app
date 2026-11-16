import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import {
	createLabel,
	deleteLabel,
	listLabelRows,
	renameLabel,
	type LabelResult
} from '$lib/server/services/contacts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return { labels: await listLabelRows(platform.env.DB, locals.user) };
};

type LabelWrite = typeof createLabel;

// Each action posts its form to its service; a refusal comes back under the field it was typed in.
function labelAction(action: string, write: LabelWrite) {
	return async ({ locals, platform, request }: RequestEvent) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		const result: LabelResult = await write(platform.env.DB, values, locals.user);
		return result.ok ? { saved: action } : fail(400, { action, message: result.message });
	};
}

export const actions: Actions = {
	crear: labelAction('crear', createLabel),
	renombrar: labelAction('renombrar', renameLabel),
	eliminar: labelAction('eliminar', deleteLabel)
};
