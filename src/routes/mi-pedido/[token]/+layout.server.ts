import { getDb } from '$lib/server/platform';
import { getWhatsAppHref } from '$lib/server/services/public-orders';
import type { LayoutServerLoad } from './$types';

// Plain HTML, no JavaScript: nothing reaches the client's browser but what the page shows.
export const csr = false;

// Public: no `requireRole`. The contact carries the page's own URL, the order's or «ya no está
// disponible»'s, so sales knows which order the client is asking about.
export const load: LayoutServerLoad = async ({ platform, url }) => {
	const db = getDb(platform);
	const text = `Hola. Tengo una duda con mi pedido ${url.origin}${url.pathname}`;
	return { whatsAppHref: await getWhatsAppHref(db, text) };
};
