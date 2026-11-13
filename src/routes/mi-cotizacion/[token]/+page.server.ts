import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { hasAnyRole } from '$lib/server/actor';
import { renderTerms } from '$lib/server/markdown';
import {
	findConvertedOrderToken,
	findQuoteIdByToken,
	getClientTerms,
	getPublicQuote,
	getWhatsAppHref
} from '$lib/server/services/public-orders';
import type { PageServerLoad } from './$types';

// Public: no `requireRole`, and it writes nothing. Whoever sees quotes, opening a client's link,
// goes to the quote's detail in any state; anyone else, WAREHOUSE and DRIVER included, follows a
// converted quote's link to its order's page, and gets the client's page otherwise. The session is
// only read.
export const load: PageServerLoad = async ({ locals, params, platform, url }) => {
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	if (null !== locals.user && hasAnyRole(locals.user, ['ADMIN', 'MANAGER', 'SALES'])) {
		const id = await findQuoteIdByToken(db, params.token);
		if (null !== id) {
			redirect(303, resolve('/(app)/cotizaciones/[id]', { id: String(id) }));
		}
	}
	const orderToken = await findConvertedOrderToken(db, params.token);
	if (null !== orderToken) {
		redirect(303, resolve('/mi-pedido/[token]', { token: orderToken }));
	}
	const quote = await getPublicQuote(db, params.token);
	if (null === quote) {
		error(404, 'Esta cotización ya no está disponible');
	}
	// Both buttons are only WhatsApp links: tapping one writes nothing.
	const link = `${url.origin}${url.pathname}`;
	const [confirmHref, changesHref] = await Promise.all([
		getWhatsAppHref(db, `Hola. Quiero confirmar la cotización #${quote.id} ${link}`),
		getWhatsAppHref(db, `Hola. Quiero solicitar cambios en la cotización #${quote.id} ${link}`)
	]);
	const terms = renderTerms(await getClientTerms(db));
	return { quote, confirmHref, changesHref, terms };
};
