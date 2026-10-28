import { error } from '@sveltejs/kit';
import { requireRole, ROLES } from '$lib/server/actor';
import { renderHelp } from '$lib/server/markdown';
import { getHelp } from '$lib/server/services/settings';
import type { PageServerLoad } from './$types';

// The help, open to every login: rendered here, so only `renderHelp`'s HTML reaches the page.
export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ROLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const { text, updatedAt } = await getHelp(platform.env.DB, locals.user);
	return { help: renderHelp(text), updatedAt };
};
