import { error, fail } from '@sveltejs/kit';
import { getTodaysDate } from '$lib/datetime';
import { requireRole } from '$lib/server/actor';
import { listEmployees } from '$lib/server/services/employees';
import { getEmployeeHours, saveEmployeePunch } from '$lib/server/services/timesheets';
import type { Actions, PageServerLoad } from './$types';

// Any employee's punches, for ADMIN and MANAGER: the selector's employee (`?empleado=`; by default
// the actor's own, or the first one), then the same day and week as Mis horas.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const employees = await listEmployees(platform.env.DB, locals.user);
	const employeeId =
		url.searchParams.get('empleado') ?? locals.user.employeeId ?? employees[0]?.id ?? null;
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
	return {
		today,
		employees: options,
		hours: await getEmployeeHours(platform.env.DB, input, locals.user)
	};
};

export const actions: Actions = {
	// The time dialog: one punch of the employee in the form's `employee_id`.
	marcar: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const input = Object.fromEntries(await request.formData());
		const result = await saveEmployeePunch(platform.env.DB, input, locals.user);
		if (!result.ok) {
			return fail(400, { message: result.message });
		}
		return { saved: true };
	}
};
