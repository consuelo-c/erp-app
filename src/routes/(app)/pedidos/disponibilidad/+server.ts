import { error, json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { checkOrderSchedule } from '$lib/server/services/orders';
import type { RequestHandler } from './$types';

// The order form asks, as its dates and times change, what's available for them and what to
// warn about. `?pedido=` is the order being edited: its own lines and trips don't count.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const params = url.searchParams;
	const input = {
		order_id: params.get('pedido'),
		delivery_date: params.get('entrega'),
		pickup_date: params.get('recogida'),
		delivery_time: params.get('hora_entrega'),
		pickup_time: params.get('hora_recogida')
	};
	return json(await checkOrderSchedule(platform.env.DB, input, locals.user));
};
