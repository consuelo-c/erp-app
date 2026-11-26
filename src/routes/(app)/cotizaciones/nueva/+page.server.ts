import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { isBannedClient } from '$lib/server/services/contacts';
import {
	createQuote,
	getOrderRequote,
	getQuoteDuplicate,
	getQuoteFormOptions
} from '$lib/server/services/quotes';
import { readPostedJson } from '$lib/server/posted-json';
import type { Actions, PageServerLoad } from './$types';

// `?desde=12` is «Duplicar», from quote #12; `?pedido=1060` is «Cotizar de nuevo», from order #1060.
// The form opens filled, and nothing is written until saved.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.quotes);
	const db = getDb(platform);
	const options = await getQuoteFormOptions(db, locals.user);
	const from = url.searchParams.get('desde');
	const order = url.searchParams.get('pedido');
	if (null !== order) {
		const copy = await getOrderRequote(db, order, locals.user);
		if (null === copy) {
			error(404, 'Ese pedido no existe');
		}
		const isClientBanned = await isBannedClient(db, copy.draft.clientId, locals.user);
		return { options, copy, isClientBanned };
	}
	if (null === from) {
		return { options, copy: null, isClientBanned: false };
	}
	const copy = await getQuoteDuplicate(db, from, locals.user);
	if (null === copy) {
		error(404, 'Esa cotización no existe');
	}
	const isClientBanned = await isBannedClient(db, copy.draft.clientId, locals.user);
	return { options, copy, isClientBanned };
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.quotes);
		const db = getDb(platform);
		const quote = readPostedJson(await request.formData(), 'quote');
		const result = await createQuote(db, quote, locals.user);
		if (!result.ok) {
			return fail(400, result);
		}
		redirect(303, `${resolve('/(app)/cotizaciones/[id]', { id: String(result.id) })}?guardado`);
	}
};
