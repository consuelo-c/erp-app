import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { correctIncident, listIncidents } from '$lib/server/services/incidents';
import { getOrderDetail } from '$lib/server/services/orders';
import { readPostedItems } from '../posted-items';
import type { Actions, PageServerLoad } from './$types';

// «Corregir»: the report form, pre-filled with one of the order's incidents the actor may correct.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.anyLogin);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const order = await getOrderDetail(platform.env.DB, params.id, locals.user);
	if (null === order) {
		error(404, 'Ese pedido no existe');
	}
	const incidents = await listIncidents(platform.env.DB, order.id, locals.user);
	const incident = incidents.find((each) => String(each.id) === params.incidentId);
	if (undefined === incident) {
		error(404, 'Esa novedad no existe');
	}
	if (!incident.canCorrect) {
		error(403, 'Esta novedad no se puede corregir');
	}
	return { order, incident };
};

export const actions: Actions = {
	// Saved, it goes back to the operational detail, on the day it was opened from.
	default: async ({ locals, params, platform, request, url }) => {
		requireRole(locals.user, POLICIES.anyLogin);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const formData = await request.formData();
		const input = {
			id: params.incidentId,
			incident_description: formData.get('incident_description'),
			items: readPostedItems(formData.get('items'))
		};
		const result = await correctIncident(platform.env.DB, input, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, errors: result.errors });
		}
		redirect(303, `${resolve('/(app)/despachos/[id]', { id: params.id })}${url.search}`);
	}
};
