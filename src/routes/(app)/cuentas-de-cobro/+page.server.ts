import { requireRole } from '$lib/server/actor';
import type { PageServerLoad } from './$types';

// STUB: #418 (phase 16) replaces this with the receivable list (42).
export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
};
