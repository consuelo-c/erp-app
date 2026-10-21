import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getReceipt } from '$lib/server/services/cash';
import type { PageServerLoad } from './$types';

// A movement's printed recibo de caja or comprobante de egreso: `?movimiento=`.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return {
		receipt: await getReceipt(platform.env.DB, url.searchParams.get('movimiento'), locals.user)
	};
};
