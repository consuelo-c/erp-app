import { requireRole } from '$lib/server/actor';
import type { PageServerLoad } from './$types';

// STUB: Phase 13's #402 replaces this with the half-letter quote printout.
export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
};
