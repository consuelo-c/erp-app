import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getWhatsAppHref } from '$lib/server/services/public-orders';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, locals }) => {
	if (null !== locals.user) {
		redirect(303, resolve('/despachos'));
	}
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return {
		whatsAppHref: await getWhatsAppHref(platform.env.DB, 'Hola. Tengo una duda con mi pedido.')
	};
};
