import { error, json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { listIncidents } from '$lib/server/services/incidents';
import { getDespachosPaymentEntry, getOrderDetail } from '$lib/server/services/orders';
import type { RequestHandler } from './$types';

// The operational detail as JSON, for its universal load: the whole order, prices included, for
// every role, with its «Novedades» and what «Registrar pago» offers this login. Never kept in the
// offline copy: offline, only the order's «Con novedad» badge shows, and no payment entry.
export const GET: RequestHandler = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.anyLogin);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const order = await getOrderDetail(db, params.id, locals.user);
	if (null === order) {
		error(404, 'Ese pedido no existe');
	}
	const incidents = await listIncidents(db, order.id, locals.user);
	const paymentConcepts = getDespachosPaymentEntry(order, locals.user).concepts;
	return json({ order, incidents, paymentConcepts });
};
