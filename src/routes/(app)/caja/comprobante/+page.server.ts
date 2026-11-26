import { POLICIES } from '$lib/roles';
import { hasAnyRole, requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getReceipt } from '$lib/server/services/cash';
import type { PageServerLoad } from './$types';

// A movement's printed recibo de caja or comprobante de egreso: `?movimiento=`. Sales prints an
// order movement's from the order and a cuenta movement's from the cuenta, and goes back to it.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.paymentReceipts);
	const db = getDb(platform);
	return {
		receipt: await getReceipt(db, url.searchParams.get('movimiento'), locals.user),
		opensCashBook: hasAnyRole(locals.user, POLICIES.cashBookLink)
	};
};
