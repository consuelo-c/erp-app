import { requireRole } from '$lib/server/actor';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
};
