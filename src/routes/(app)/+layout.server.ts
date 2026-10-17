import { requireRole, ROLES } from '$lib/server/actor';
import type { LayoutServerLoad } from './$types';

// The shell needs a session. Without one this throws above the shell, so the error screen shows
// no navigation; each page's own requireRole still decides which roles get in.
export const load: LayoutServerLoad = ({ locals }) => {
	requireRole(locals.user, ROLES);
	return { username: locals.user.username };
};
