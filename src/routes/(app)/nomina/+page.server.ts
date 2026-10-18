import { error, fail } from '@sveltejs/kit';
import { getTodaysDate } from '$lib/datetime';
import { requireRole } from '$lib/server/actor';
import { rememberEmployee } from '$lib/server/chosen-employee';
import { openWeek, recordPayment, saveDraft } from '$lib/server/services/payroll';
import type { Actions, PageServerLoad } from './$types';

// One employee's settlement for one week: `?empleado=` (by default the one picked last, here or in
// Horas, if they worked the period; otherwise the first one) and `?semana=`, any date of the week
// (this one by default).
export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = {
		employeeId: url.searchParams.get('empleado'),
		preferredEmployeeId: rememberEmployee(url, cookies),
		week: url.searchParams.get('semana')
	};
	return {
		today: getTodaysDate(),
		week: await openWeek(platform.env.DB, input, locals.user)
	};
};

type Write = typeof saveDraft;

// Both buttons post the same form: «Guardar borrador» saves it, «Registrar pago» saves and pays it.
function action(write: Write, done: Record<string, true>): Actions[string] {
	return async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const values = Object.fromEntries(await request.formData());
		const result = await write(platform.env.DB, values, locals.user);
		return result.ok ? done : fail(400, { message: result.message, errors: result.errors, values });
	};
}

export const actions: Actions = {
	guardar: action(saveDraft, { saved: true }),
	pagar: action(recordPayment, { paid: true })
};
