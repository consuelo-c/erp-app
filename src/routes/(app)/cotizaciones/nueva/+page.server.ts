import { requireRole } from '$lib/server/actor';
import type { PageServerLoad } from './$types';

// STUB: Phase 13's #399 replaces this with the quote form.
export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
};
