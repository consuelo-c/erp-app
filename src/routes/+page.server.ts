import { error } from '@sveltejs/kit';
import { getWhatsAppHref } from '$lib/server/services/public-orders';
import type { PageServerLoad } from './$types';

// Public: no `requireRole`, and a logged-in employee sees the same as anyone.
export const load: PageServerLoad = async ({ platform }) => {
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return {
		whatsAppHref: await getWhatsAppHref(platform.env.DB, 'Hola. Tengo una duda con mi pedido.')
	};
};
