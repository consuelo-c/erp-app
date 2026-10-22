import { error, json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { matchPhone } from '$lib/server/services/employees';
import type { RequestHandler } from './$types';

// The new employee form asks, as Teléfono changes, which contact that phone would reuse.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return json(await matchPhone(platform.env.DB, url.searchParams.get('telefono'), locals.user));
};
