import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getCashStatement, listPeopleWithTab } from '$lib/server/services/cash-handovers';
import type { PageServerLoad } from './$types';

// The manager's side of each tab. The person and the range live in the URL, `?persona=`,
// `?desde=` and `?hasta=`: the first person and today by default.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.managesCash);
	const db = getDb(platform);
	const people = await listPeopleWithTab(db, locals.user);
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
	const statement = await getCashStatement(db, input, locals.user);
	if (null === statement) {
		error(404, 'Esa persona no tiene efectivo por entregar');
	}
	return { people, person, statement };
};
