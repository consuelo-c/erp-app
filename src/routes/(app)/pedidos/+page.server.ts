import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { listOrders } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The filters live in the URL, so a filtered list can be shared and reloaded: `?texto=` (name or
// phone), `?entrega=` (this week's by default), `?desde=`, `?hasta=`, `?estado=`, `?novedad=1`, and
// `?pagina=`, the page shown.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const params = url.searchParams;
	const input = {
		text: params.get('texto'),
		delivery: params.get('entrega'),
		from: params.get('desde'),
		to: params.get('hasta'),
		status: params.get('estado'),
		hasIncident: params.get('novedad'),
		page: params.get('pagina') ?? undefined
	};
	return listOrders(platform.env.DB, input, locals.user);
};
