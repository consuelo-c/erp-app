import { error } from '@sveltejs/kit';
import { requireRole, type Actor } from '$lib/server/actor';
import { getCashBook, getMovement } from '$lib/server/services/cash';
import type { PageServerLoad } from './$types';

// The filters live in the URL, so a filtered book can be shared and reloaded: `?desde=`, `?hasta=`
// (this month by default), `?tipo=`, `?concepto=`, `?metodo=`, `?pedido=`, `?empleado=`, `?minimo=`,
// `?maximo=` and `?texto=`. `?movimiento=` opens one movement's detail over them: its own view on a phone, a
// side panel on a desktop.
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
		order: params.get('pedido'),
		employee: params.get('empleado'),
		min: params.get('minimo'),
		max: params.get('maximo'),
		text: params.get('texto')
	};
	const db = platform.env.DB;
	const [book, movement] = await Promise.all([
		getCashBook(db, input, locals.user),
		params.has('movimiento') ? findMovement(db, params.get('movimiento'), locals.user) : null
	]);
	return { book, movement };
};

async function findMovement(db: D1Database, id: string | null, actor: Actor | null) {
	const movement = await getMovement(db, id, actor);
	if (null === movement) {
		error(404, 'Ese movimiento no existe');
	}
	return movement;
}
