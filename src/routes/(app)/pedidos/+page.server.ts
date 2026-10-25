import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { listOrders } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The filters live in the URL, so a filtered list can be shared and reloaded: `?telefono=`,
// `?nombre=`, `?desde=`, `?hasta=`, `?estado=`, `?minimo=`, `?maximo=`, `?novedad=1`, and
// `?pagina=`, the page shown.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const params = url.searchParams;
	const input = {
		phone: params.get('telefono'),
		name: params.get('nombre'),
		from: params.get('desde'),
		to: params.get('hasta'),
		status: params.get('estado'),
		min: params.get('minimo'),
		max: params.get('maximo'),
		hasIncident: params.get('novedad'),
		page: params.get('pagina') ?? undefined
	};
	return listOrders(platform.env.DB, input, locals.user);
};
