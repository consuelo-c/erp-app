import { requireRole, ROLES } from '$lib/server/actor';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals.user, ROLES);
	return { username: locals.user.username };
};
