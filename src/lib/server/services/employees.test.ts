import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Actor, Role } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import {
	createEmployee,
	employmentSchema,
	endEmployment,
	getEmployee,
	listEmployees,
	rehire,
	updateEmployee
} from './employees';

const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
});

const carlos = {
	full_name: 'Carlos Vélez',
	id_number: '71.384.902',
	monthly_salary: '$1.423.500',
	position: 'Bodega',
	start: '2024-07-15'
};

async function hire(input: Record<string, string> = carlos): Promise<number> {
	const result = await createEmployee(db, input, manager);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.id;
}

function events() {
	return database.prepare('select action, before, after from events order by id').all();
}

test('creating stores digits only and opens the first period, with a CREATED event', async () => {
	const id = await hire();
	expect(await getEmployee(db, id, manager)).toEqual({
		id,
		fullName: 'Carlos Vélez',
		idNumber: '71384902',
		monthlySalary: 1423500,
		position: 'Bodega',
		employment: [{ start: '2024-07-15', end: null }],
		isEmployed: true
	});
	expect(events()).toMatchObject([{ action: 'CREATED', before: null }]);
});

test('a second employee with the same ID number is rejected with a message', async () => {
	await hire();
	const result = await createEmployee(db, { ...carlos, id_number: '71384902' }, manager);
	expect(result).toEqual({ ok: false, message: 'Ya existe un empleado con esa cédula' });
});

test('editing logs only the changed fields in before/after', async () => {
	const id = await hire();
	await updateEmployee(db, { ...carlos, id, full_name: 'Carlos A. Vélez' }, manager);
	const edited = events()[1];
	expect(edited).toMatchObject({ action: 'EDITED' });
	expect(JSON.parse(String(edited.before))).toEqual({ full_name: 'Carlos Vélez' });
	expect(JSON.parse(String(edited.after))).toEqual({ full_name: 'Carlos A. Vélez' });
});

test('ending sets the last period end; rehiring appends a period to the same row', async () => {
	const id = await hire();
	expect((await endEmployment(db, { id, end: '2025-06-30' }, manager)).ok).toBe(true);
	expect((await getEmployee(db, id, manager))?.isEmployed).toBe(false);

	const early = await rehire(db, { id, start: '2025-06-30' }, manager);
	expect(early).toEqual({
		ok: false,
		message: 'La fecha de ingreso debe ser posterior al último retiro'
	});
	expect((await rehire(db, { id, start: '2026-01-13' }, manager)).ok).toBe(true);

	expect((await getEmployee(db, id, manager))?.employment).toEqual([
		{ start: '2024-07-15', end: '2025-06-30' },
		{ start: '2026-01-13', end: null }
	]);
	expect(database.prepare('select count(*) as count from employees').get()?.count).toBe(1);
	expect(events().map((row) => row.action)).toEqual(['CREATED', 'EDITED', 'EDITED']);
});

test('an employment cannot end before it started', async () => {
	const id = await hire();
	const result = await endEmployment(db, { id, end: '2024-07-14' }, manager);
	expect(result).toEqual({
		ok: false,
		message: 'La fecha de retiro no puede ser anterior al ingreso'
	});
});

test('the list puts the currently employed first, by name', async () => {
	const jorge = await hire({ ...carlos, full_name: 'Jorge Salamanca', id_number: '98552017' });
	await endEmployment(db, { id: jorge, end: '2026-03-31' }, manager);
	await hire({ ...carlos, full_name: 'Carlos Vélez' });
	await hire({ ...carlos, full_name: 'Ana Pérez', id_number: '1036452118' });
	const names = (await listEmployees(db, manager)).map((employee) => employee.fullName);
	expect(names).toEqual(['Ana Pérez', 'Carlos Vélez', 'Jorge Salamanca']);
});

test('SALES, WAREHOUSE and DRIVER get a 403', async () => {
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const actor: Actor = { ...manager, roles: [role] };
		await expect(listEmployees(db, actor)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	}
});

test('employmentSchema rejects overlapping, unsorted and open-but-not-last periods', () => {
	const closed = { start: '2023-01-10', end: '2023-12-31' };
	expect(employmentSchema.safeParse([closed, { start: '2024-01-01', end: null }]).success).toBe(
		true
	);
	expect(employmentSchema.safeParse([closed, { start: '2023-12-31', end: null }]).success).toBe(
		false
	);
	expect(employmentSchema.safeParse([{ start: '2024-01-01', end: null }, closed]).success).toBe(
		false
	);
	expect(
		employmentSchema.safeParse([
			{ start: '2022-01-01', end: null },
			{ start: '2024-01-01', end: null }
		]).success
	).toBe(false);
	expect(employmentSchema.safeParse([]).success).toBe(false);
});
