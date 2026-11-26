import { error, fail } from '@sveltejs/kit';
import { getTodaysDate } from '$lib/datetime';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { rememberEmployee } from '$lib/server/chosen-employee';
import { getDb } from '$lib/server/platform';
import { openWeek, recordPayment, saveDraft } from '$lib/server/services/payroll';
import type { Actions, PageServerLoad } from './$types';

// One employee's settlement for one week: `?empleado=` (by default the one picked last, here or in
// Horas, if they worked the period; otherwise the first one) and `?semana=`, any date of the week
// (this one by default).
export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, POLICIES.payroll);
	const db = getDb(platform);
	const input = {
		employeeId: url.searchParams.get('empleado'),
		preferredEmployeeId: rememberEmployee(url, cookies),
		week: url.searchParams.get('semana')
	};
	const week = await openWeek(db, input, locals.user);
	if (null === week) {
		error(404, 'Ese empleado no trabajó en este periodo');
	}
	return { today: getTodaysDate(), week };
};

type Write = typeof saveDraft;

// Both buttons post the same form: «Guardar borrador» saves it, «Registrar pago» saves and pays it.
function action(write: Write, done: Record<string, true>): Actions[string] {
	return async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.payroll);
		const db = getDb(platform);
		const values = Object.fromEntries(await request.formData());
		const result = await write(db, values, locals.user);
		return result.ok ? done : fail(400, { message: result.message, errors: result.errors, values });
	};
}

export const actions: Actions = {
	guardar: action(saveDraft, { saved: true }),
	pagar: action(recordPayment, { paid: true })
};
