import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getReceivableDetail } from '$lib/server/services/receivables';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const receivable = await getReceivableDetail(platform.env.DB, params.id, locals.user);
	if (null === receivable) {
		error(404, 'Esa cuenta de cobro no existe');
	}
	return { receivable };
};
