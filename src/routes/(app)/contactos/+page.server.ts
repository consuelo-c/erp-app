import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { listContacts } from '$lib/server/services/contacts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = {
		search: url.searchParams.get('texto') ?? undefined,
		service: url.searchParams.get('servicio') ?? undefined,
		pages: url.searchParams.get('paginas') ?? undefined
	};
	return listContacts(platform.env.DB, input, locals.user);
};
