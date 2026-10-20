import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getCashBook } from '$lib/server/services/cash';
import type { PageServerLoad } from './$types';

// The filters live in the URL, so a filtered book can be shared and reloaded: `?desde=`, `?hasta=`
// (this month by default), `?tipo=`, `?concepto=`, `?metodo=`, `?empleado=`, `?minimo=`, `?maximo=`
// and `?texto=`.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const params = url.searchParams;
	const input = {
		from: params.get('desde'),
		to: params.get('hasta'),
		direction: params.get('tipo'),
		concept: params.get('concepto'),
		method: params.get('metodo'),
		employee: params.get('empleado'),
		min: params.get('minimo'),
		max: params.get('maximo'),
		text: params.get('texto')
	};
	return { book: await getCashBook(platform.env.DB, input, locals.user) };
};
