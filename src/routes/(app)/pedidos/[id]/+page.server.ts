import { error, fail } from '@sveltejs/kit';
import { isAdminOrManager, requireRole, type Actor } from '$lib/server/actor';
import {
	listIncidents,
	reverseIncident,
	setResponsibleParty
} from '$lib/server/services/incidents';
import {
	cancelOrder,
	getOrderDetail,
	getPublicToken,
	offeredPaymentConcepts,
	type OrderDetail
} from '$lib/server/services/orders';
import { getSourceQuoteId } from '$lib/server/services/quotes';
import { getReceivableIssueForm } from '$lib/server/services/receivables';
import type { Actions, PageServerLoad } from './$types';

const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;
const MANAGES_INCIDENTS = ['ADMIN', 'MANAGER'] as const;

// What the order offers for its money: the payment entry's concepts, which hide «Registrar pago»
// when empty, and whether the order can start a cuenta de cobro. Everyone who opens an order also
// works cuentas de cobro, so its cuenta is always a link.
async function getPaymentActions(db: D1Database, order: OrderDetail, actor: Actor) {
	const paymentConcepts = offeredPaymentConcepts(order, actor);
	const form = await getReceivableIssueForm(db, order.id, actor);
	return { paymentConcepts, canIssueReceivable: null !== form };
}

// «Novedades» only for ADMIN and MANAGER: null hides the section for everyone else.
// The quote it was converted from, if any, for «Desde la cotización #N».
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, TAKES_ORDERS);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const order = await getOrderDetail(db, params.id, locals.user);
	if (null === order) {
		error(404, 'Ese pedido no existe');
	}
	const incidents = isAdminOrManager(locals.user)
		? await listIncidents(db, order.id, locals.user)
		: null;
	const publicToken = await getPublicToken(db, order.id, locals.user);
	const quoteId = await getSourceQuoteId(db, order.id, locals.user);
	const paymentActions = await getPaymentActions(db, order, locals.user);
	return { order, incidents, publicToken, quoteId, ...paymentActions };
};

export const actions: Actions = {
	cancelar: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, TAKES_ORDERS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { reason } = Object.fromEntries(await request.formData());
		const input = { id: params.id, reason };
		const result = await cancelOrder(platform.env.DB, input, locals.user);
		if (result.ok) {
			return { cancelled: true };
		}
		return fail(400, { cancelMessage: result.errors.reason ?? result.message });
	},
	revertir: async ({ locals, platform, request }) => {
		requireRole(locals.user, MANAGES_INCIDENTS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { id, reason } = Object.fromEntries(await request.formData());
		const result = await reverseIncident(platform.env.DB, { id, reason }, locals.user);
		if (result.ok) {
			return { reversed: true };
		}
		return fail(400, { reverseMessage: result.errors.reason ?? result.message });
	},
	responsable: async ({ locals, platform, request }) => {
		requireRole(locals.user, MANAGES_INCIDENTS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const { id, responsible_party } = Object.fromEntries(await request.formData());
		const input = { id, responsible_party };
		const result = await setResponsibleParty(platform.env.DB, input, locals.user);
		return result.ok ? { assigned: true } : fail(400, { assignMessage: result.message });
	}
};
