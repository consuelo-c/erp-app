import { error, json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { previewApproval } from '$lib/server/services/inventory';
import type { RequestHandler } from './$types';

// «Guardar y aprobar» asks, before its confirmation, what approving the typed count would change
// and which pending counts share its products.
export const POST: RequestHandler = async ({ locals, platform, request }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return json(await previewApproval(platform.env.DB, await request.json(), locals.user));
};
