import { redirect } from '@sveltejs/kit';
import { requireRole, ROLES } from '$lib/server/actor';
import { getDispatchTab } from '$lib/navigation';
import type { PageServerLoad } from './$types';

// Where every login lands: the tab its roles work from.
export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals.user, ROLES);
	redirect(303, getDispatchTab(locals.user.roles));
};
