import { getTodaysDate } from '$lib/datetime';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { rememberFilters } from '$lib/server/list-filters';
import { getDb } from '$lib/server/platform';
import { getAuditLog } from '$lib/server/services/reports';
import type { PageServerLoad } from './$types';

// The filters live in the URL, so a filtered log can be shared and reloaded: `?desde=`, `?hasta=`
// (Bogotá dates, both inclusive; none is every Event), `?usuario=`, `?registro=`, `?accion=`, and
// `?pagina=`, the page shown.
export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, POLICIES.reports);
	rememberFilters('auditoria', url, cookies);
	const db = getDb(platform);
	const params = url.searchParams;
	const input = {
		from: params.get('desde'),
		to: params.get('hasta'),
		username: params.get('usuario'),
		entityType: params.get('registro'),
		action: params.get('accion'),
		page: params.get('pagina') ?? undefined
	};
	const log = await getAuditLog(db, input, locals.user);
	return { ...log, today: getTodaysDate() };
};
