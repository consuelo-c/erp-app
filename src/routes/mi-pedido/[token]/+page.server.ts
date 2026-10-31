import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { hasAnyRole } from '$lib/server/actor';
import { renderTerms } from '$lib/server/markdown';
import {
	findOrderIdByToken,
	getClientTerms,
	getPublicOrder
} from '$lib/server/services/public-orders';
import type { PageServerLoad } from './$types';

// Public: no `requireRole`. An employee, who opens it from the client's WhatsApp, goes to the
// order in the dashboard instead; the session is only read.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	if (null !== locals.user) {
		const id = await findOrderIdByToken(db, params.token);
		if (null !== id) {
			redirect(
				303,
				hasAnyRole(locals.user, ['ADMIN', 'MANAGER', 'SALES'])
					? resolve('/(app)/pedidos/[id]', { id: String(id) })
					: resolve('/(app)/despachos/[id]', { id: String(id) })
			);
		}
	}
	const order = await getPublicOrder(db, params.token);
	if (null === order) {
		error(404, 'Este pedido ya no está disponible');
	}
	return { order, terms: renderTerms(await getClientTerms(db)) };
};
