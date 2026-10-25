import { error } from '@sveltejs/kit';
import { isAdminOrManager, requireRole } from '$lib/server/actor';
import { getReceipt } from '$lib/server/services/cash';
import type { PageServerLoad } from './$types';

// A movement's printed recibo de caja or comprobante de egreso: `?movimiento=`. Sales prints an
// order movement's, from the order, and goes back to it.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return {
		receipt: await getReceipt(platform.env.DB, url.searchParams.get('movimiento'), locals.user),
		opensCashBook: isAdminOrManager(locals.user)
	};
};
