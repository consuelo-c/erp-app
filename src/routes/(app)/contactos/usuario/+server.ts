import { json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { findWhatsappOwner } from '$lib/server/services/contacts';
import type { RequestHandler } from './$types';

// The contact and employee forms ask, once a username is typed, whether another contact has it, to
// warn under the field. `?contacto=` is the contact being edited: its own username doesn't count.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.contacts);
	const db = getDb(platform);
	const input = {
		whatsapp: url.searchParams.get('usuario'),
		exceptId: url.searchParams.get('contacto')
	};
	return json({ owner: await findWhatsappOwner(db, input, locals.user) });
};
