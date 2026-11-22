import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getCashStatement, listPeopleWithTab } from '$lib/server/services/cash-handovers';
import type { PageServerLoad } from './$types';

// The manager's side of each tab. The person and the range live in the URL, `?persona=`,
// `?desde=` and `?hasta=`: the first person and today by default.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const people = await listPeopleWithTab(platform.env.DB, locals.user);
	const chosen = url.searchParams.get('persona');
	const person = people.find(({ username }) => username === chosen) ?? people[0];
	if (undefined === person) {
		return { people, person: null, statement: null };
	}
	const input = {
		username: person.username,
		from: url.searchParams.get('desde'),
		to: url.searchParams.get('hasta')
	};
	return { people, person, statement: await getCashStatement(platform.env.DB, input, locals.user) };
};
