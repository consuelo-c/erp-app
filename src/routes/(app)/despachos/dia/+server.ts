import { json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { rememberDispatchDay } from '$lib/server/list-filters';
import { getDb } from '$lib/server/platform';
import { getDispatchDay } from '$lib/server/services/dispatch';
import { getOrderDetail } from '$lib/server/services/orders';
import type { RequestHandler } from './$types';

// Despachos' day as JSON, for the list's universal load. Today's also brings each listed order's
// operational detail: the copy the phone keeps for when there's no signal.
// ponytail: one getOrderDetail per order, a handful of queries each; a joined query if a day ever
// holds more than a few dozen orders.
export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, POLICIES.anyLogin);
	const db = getDb(platform);
	const day = await getDispatchDay(db, rememberDispatchDay(url, cookies), locals.user);
	if (day.date !== day.today) {
		return json({ day, details: null });
	}
	const ids = [...new Set(day.rows.map((row) => row.id))];
	const details = await Promise.all(
		ids.map(async (id) => [id, await getOrderDetail(db, id, locals.user)] as const)
	);
	return json({
		day,
		details: Object.fromEntries(details.filter(([, detail]) => null !== detail))
	});
};
