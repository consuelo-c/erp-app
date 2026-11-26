import { error, fail } from '@sveltejs/kit';
import { getTodaysDate } from '$lib/datetime';
import { POLICIES } from '$lib/roles';
import { requireRole, type Actor } from '$lib/server/actor';
import { rememberEmployee } from '$lib/server/chosen-employee';
import { getDb } from '$lib/server/platform';
import { listEmployees } from '$lib/server/services/employees';
import {
	clearEmployeeDay,
	getEmployeeHours,
	saveEmployeePunch,
	type Hours
} from '$lib/server/services/timesheets';
import type { Actions, PageServerLoad } from './$types';

// The employee's day and week; an unknown employee or day is the error page.
async function findHours(
	db: D1Database,
	input: Parameters<typeof getEmployeeHours>[1],
	actor: Actor
): Promise<Hours> {
	const hours = await getEmployeeHours(db, input, actor);
	if (null === hours) {
		error(404, 'Ese empleado no existe');
	}
	if ('missing' in hours) {
		error(404, 'Ese día no existe');
	}
	return hours;
}

// Any employee's punches, for ADMIN and MANAGER: the selector's employee (`?empleado=`; by default
// the one picked last, here or in Nómina, then the actor's own, or the first one), then the same
// day and week as Mis horas.
export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, POLICIES.everyonesHours);
	const db = getDb(platform);
	const employees = await listEmployees(db, locals.user);
	const employeeId =
		rememberEmployee(url, cookies) ?? locals.user.employeeId ?? employees[0]?.id ?? null;
	const today = getTodaysDate();
	// Only what the selector shows: the salary stays on the server.
	const options = employees.map(({ id, fullName, position, isEmployed }) => ({
		id,
		fullName,
		position,
		isEmployed
	}));
	if (null === employeeId) {
		return { today, employees: options, hours: null };
	}
	const input = {
		employeeId,
		date: url.searchParams.get('dia') ?? today,
		week: url.searchParams.get('semana')
	};
	return { today, employees: options, hours: await findHours(db, input, locals.user) };
};

export const actions: Actions = {
	// The time dialog: one punch of the employee in the form's `employee_id`.
	marcar: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.everyonesHours);
		const db = getDb(platform);
		const input = Object.fromEntries(await request.formData());
		const result = await saveEmployeePunch(db, input, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		return { saved: true };
	},
	// «Borrar marcas del día»: the four punches of that day back to empty.
	borrar: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.everyonesHours);
		const db = getDb(platform);
		const input = Object.fromEntries(await request.formData());
		const result = await clearEmployeeDay(db, input, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		return { cleared: true };
	}
};
