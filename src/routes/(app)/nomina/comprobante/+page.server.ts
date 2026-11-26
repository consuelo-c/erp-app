import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getReceipt } from '$lib/server/services/payroll';
import type { PageServerLoad } from './$types';

const MISSING = {
	employee: 'Ese empleado no trabajó en este periodo',
	payment: 'Esa liquidación todavía no está pagada'
};

// The printed receipt of a paid settlement: `?empleado=` and `?semana=`, any date of the week.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.payroll);
	const db = getDb(platform);
	const input = {
		employeeId: url.searchParams.get('empleado'),
		week: url.searchParams.get('semana')
	};
	const receipt = await getReceipt(db, input, locals.user);
	if ('missing' in receipt) {
		error(404, MISSING[receipt.missing]);
	}
	return { receipt };
};
