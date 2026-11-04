import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getReceivablePrintout } from '$lib/server/services/receivables';
import type { PageServerLoad } from './$types';

// The cuenta's letter sheets, printed from its detail.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const printout = await getReceivablePrintout(platform.env.DB, params.id, locals.user);
	if (null === printout) {
		error(404, 'Esa cuenta de cobro no existe');
	}
	return { printout };
};
