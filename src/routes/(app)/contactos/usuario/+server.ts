import { error, json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { findWhatsappOwner } from '$lib/server/services/contacts';
import type { RequestHandler } from './$types';

// The contact and employee forms ask, once a username is typed, whether another contact has it, to
// warn under the field. `?contacto=` is the contact being edited: its own username doesn't count.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = {
		whatsapp: url.searchParams.get('usuario'),
		exceptId: url.searchParams.get('contacto')
	};
	return json({ owner: await findWhatsappOwner(platform.env.DB, input, locals.user) });
};
