import { requireRole } from '$lib/server/actor';
import type { PageServerLoad } from './$types';

// STUB: phase 09, issue #252 replaces this with the order form.
export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
};
