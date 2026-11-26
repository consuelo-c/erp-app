import { json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { checkOrderSchedule } from '$lib/server/services/orders';
import type { RequestHandler } from './$types';

// The order form asks, as its dates and times change, what's available for them and what to
// warn about. `?pedido=` is the order being edited: its own lines and trips don't count.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.orders);
	const db = getDb(platform);
	const params = url.searchParams;
	const input = {
		order_id: params.get('pedido'),
		delivery_date: params.get('entrega'),
		pickup_date: params.get('recogida'),
		delivery_time: params.get('hora_entrega'),
		pickup_time: params.get('hora_recogida')
	};
	return json(await checkOrderSchedule(db, input, locals.user));
};
