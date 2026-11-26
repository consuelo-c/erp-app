import { error, fail } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole, type Actor } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
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

// What the order offers for its money: the payment entry's concepts, which hide «Registrar pago»
// when empty, and whether the order can start a cuenta de cobro. Everyone who opens an order also
// works cuentas de cobro, so its cuenta is always a link.
async function getPaymentActions(db: D1Database, order: OrderDetail, actor: Actor) {
	const paymentConcepts = offeredPaymentConcepts(order, actor);
	const form = await getReceivableIssueForm(db, order.id, actor);
	return { paymentConcepts, canIssueReceivable: null !== form };
}

// «Novedades» for everyone who opens the order, each with what the actor may do with it.
// The quote it was converted from, if any, for «Desde la cotización #N».
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.orders);
	const db = getDb(platform);
	const order = await getOrderDetail(db, params.id, locals.user);
	if (null === order) {
		error(404, 'Ese pedido no existe');
	}
	const incidents = await listIncidents(db, order.id, locals.user);
	const publicToken = await getPublicToken(db, order.id, locals.user);
	const quoteId = await getSourceQuoteId(db, order.id, locals.user);
	const paymentActions = await getPaymentActions(db, order, locals.user);
	return { order, incidents, publicToken, quoteId, ...paymentActions };
};

export const actions: Actions = {
	cancelar: async ({ locals, params, platform, request }) => {
		requireRole(locals.user, POLICIES.orders);
		const db = getDb(platform);
		const { reason } = Object.fromEntries(await request.formData());
		const input = { id: params.id, reason };
		const result = await cancelOrder(db, input, locals.user);
		if (result.ok) {
			return { cancelled: true };
		}
		return fail(400, { cancelMessage: result.errors.reason ?? result.message });
	},
	// Its reporter until it's frozen, the manager on any: the service decides.
	revertir: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.orders);
		const db = getDb(platform);
		const { id, reason } = Object.fromEntries(await request.formData());
		const result = await reverseIncident(db, { id, reason }, locals.user);
		if (result.ok) {
			return { reversed: true };
		}
		return fail(400, { reverseMessage: result.errors.reason ?? result.message });
	},
	responsable: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.incidents);
		const db = getDb(platform);
		const { id, responsible_party } = Object.fromEntries(await request.formData());
		const input = { id, responsible_party };
		const result = await setResponsibleParty(db, input, locals.user);
		return result.ok ? { assigned: true } : fail(400, { assignMessage: result.message });
	}
};
