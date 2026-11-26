import { json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { previewApproval } from '$lib/server/services/inventory';
import type { RequestHandler } from './$types';

// «Guardar y aprobar» and «Revisar conteo»'s «Aprobar» ask, before their confirmation, what
// approving the typed count, or the pending one with the reviewer's edits, would change and which
// pending counts share its products.
export const POST: RequestHandler = async ({ locals, platform, request }) => {
	requireRole(locals.user, POLICIES.inventoryReview);
	const db = getDb(platform);
	return json(await previewApproval(db, await request.json(), locals.user));
};
