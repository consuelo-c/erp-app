import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { requireRole } from '$lib/server/actor';
import {
	endEmployment,
	getEmployee,
	rehire,
	updateEmployee,
	type Result
} from '$lib/server/services/employees';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async ({ locals, platform, params }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const employee = await getEmployee(platform.env.DB, Number(params.id), locals.user);
	if (null === employee) {
		error(404, 'Ese empleado no existe');
	}
	return { employee, today: getTodaysDate() };
};

type Service = (db: D1Database, input: unknown, actor: App.Locals['user']) => Promise<Result>;

// The three forms differ only in the service they call; the id always comes from the URL.
async function submit({ locals, platform, request, params }: RequestEvent, service: Service) {
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const values = Object.fromEntries(await request.formData());
	const result = await service(platform.env.DB, { ...values, id: params.id }, locals.user);
	return result.ok ? null : fail(400, { message: result.message, values });
}

export const actions: Actions = {
	save: async (event) => {
		requireRole(event.locals.user, ['ADMIN', 'MANAGER']);
		const failure = await submit(event, updateEmployee);
		if (null !== failure) {
			return failure;
		}
		redirect(303, resolve('/personal'));
	},
	end: (event) => {
		requireRole(event.locals.user, ['ADMIN', 'MANAGER']);
		return submit(event, endEmployment);
	},
	rehire: (event) => {
		requireRole(event.locals.user, ['ADMIN', 'MANAGER']);
		return submit(event, rehire);
	}
};
