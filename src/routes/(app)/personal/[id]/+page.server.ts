import { error, fail } from '@sveltejs/kit';
import { getTodaysDate } from '$lib/datetime';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import {
	endEmployment,
	getEmployee,
	rehire,
	updateEmployee,
	type Result
} from '$lib/server/services/employees';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async ({ locals, platform, params }) => {
	requireRole(locals.user, POLICIES.employees);
	const db = getDb(platform);
	const employee = await getEmployee(db, Number(params.id), locals.user);
	if (null === employee) {
		error(404, 'Ese empleado no existe');
	}
	return { employee, today: getTodaysDate() };
};

type Service = (db: D1Database, input: unknown, actor: App.Locals['user']) => Promise<Result>;

// The three forms differ only in the service they call; the id always comes from the URL.
async function submit({ locals, platform, request, params }: RequestEvent, service: Service) {
	const db = getDb(platform);
	const values = Object.fromEntries(await request.formData());
	const result = await service(db, { ...values, id: params.id }, locals.user);
	return result.ok ? null : fail(400, { message: result.message, errors: result.errors, values });
}

export const actions: Actions = {
	save: async (event) => {
		requireRole(event.locals.user, POLICIES.employees);
		return (await submit(event, updateEmployee)) ?? { saved: true };
	},
	end: (event) => {
		requireRole(event.locals.user, POLICIES.employees);
		return submit(event, endEmployment);
	},
	rehire: (event) => {
		requireRole(event.locals.user, POLICIES.employees);
		return submit(event, rehire);
	}
};
