import { error, fail } from '@sveltejs/kit';
import { isAdminOrManager, requireRole } from '$lib/server/actor';
import {
	listIncidents,
	reverseIncident,
	setResponsibleParty
} from '$lib/server/services/incidents';
import {
	cancelOrder,
	confirmOrder,
	getOrderDetail,
	previewConfirmation,
	reopenOrder
} from '$lib/server/services/orders';
import type { Actions, PageServerLoad } from './$types';

const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;
const MANAGES_INCIDENTS = ['ADMIN', 'MANAGER'] as const;

// A draft brings what its «Confirmar» dialog shows: the suggested advance and any shortage.
// «Novedades» only for ADMIN and MANAGER: null hides the section for everyone else.
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
	const isDraft = 'DRAFT' === order.status;
	const confirmation = isDraft
		? await previewConfirmation(db, { id: order.id }, locals.user)
		: null;
	const incidents = isAdminOrManager(locals.user)
		? await listIncidents(db, order.id, locals.user)
		: null;
	return { order, confirmation, incidents };
};

export const actions: Actions = {
	confirmar: async ({ locals, params, platform }) => {
		requireRole(locals.user, TAKES_ORDERS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const result = await confirmOrder(platform.env.DB, { id: params.id }, locals.user);
		return result.ok ? { confirmed: true } : fail(400, { confirmMessage: result.message });
	},
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
	reabrir: async ({ locals, params, platform }) => {
		requireRole(locals.user, TAKES_ORDERS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const result = await reopenOrder(platform.env.DB, { id: params.id }, locals.user);
		return result.ok ? { reopened: true } : fail(400, { reopenMessage: result.message });
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
