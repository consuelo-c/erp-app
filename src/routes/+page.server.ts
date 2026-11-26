import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getDb } from '$lib/server/platform';
import { getWhatsAppHref } from '$lib/server/services/public-orders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, locals }) => {
	if (null !== locals.user) {
		redirect(303, resolve('/despachos'));
	}
	const db = getDb(platform);
	return {
		whatsAppHref: await getWhatsAppHref(db, 'Hola. Tengo una duda con mi pedido.')
	};
};
