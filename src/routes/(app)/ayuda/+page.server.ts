import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { renderHelp } from '$lib/server/markdown';
import { getDb } from '$lib/server/platform';
import { getHelp } from '$lib/server/services/settings';
import type { PageServerLoad } from './$types';

// The help, open to every login: rendered here, so only `renderHelp`'s HTML reaches the page.
export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.anyLogin);
	const db = getDb(platform);
	const { text, updatedAt } = await getHelp(db, locals.user);
	return { help: renderHelp(text), updatedAt };
};
