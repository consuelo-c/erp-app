import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getQuotePrintout } from '$lib/server/services/quotes';
import type { PageServerLoad } from './$types';

// The quote's printed half-letter sheets, printed from its detail in any state.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const printout = await getQuotePrintout(platform.env.DB, params.id, locals.user);
	if (null === printout) {
		error(404, 'Esa cotización no existe');
	}
	return { printout };
};
