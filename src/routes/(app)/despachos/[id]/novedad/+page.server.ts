import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole, ROLES } from '$lib/server/actor';
import { reportIncident } from '$lib/server/services/incidents';
import { getOrderDetail } from '$lib/server/services/orders';
import type { Actions, PageServerLoad } from './$types';

// The incident report: the order's lines to pick from, open to every role.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, ROLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const order = await getOrderDetail(platform.env.DB, params.id, locals.user);
	if (null === order) {
		error(404, 'Ese pedido no existe');
	}
	return { order };
};

// The items are a list the browser builds, posted as JSON in one field.
function readPostedItems(value: FormDataEntryValue | null): unknown {
	try {
		return JSON.parse(String(value));
	} catch {
		return null;
	}
}

export const actions: Actions = {
	// Saved, it goes back to the operational detail, on the day it was opened from.
	default: async ({ locals, params, platform, request, url }) => {
		requireRole(locals.user, ROLES);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const formData = await request.formData();
		const input = {
			order_id: params.id,
			incident_description: formData.get('incident_description'),
			items: readPostedItems(formData.get('items'))
		};
		const result = await reportIncident(platform.env.DB, input, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message, errors: result.errors });
		}
		redirect(303, `${resolve('/(app)/despachos/[id]', { id: params.id })}${url.search}`);
	}
};
