import { requireRole } from '$lib/server/actor';
import type { PageServerLoad } from './$types';

// STUB: phase 09, issue #251 replaces this with the order's detail.
export const load: PageServerLoad = ({ locals, params }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	return { id: params.id };
};
