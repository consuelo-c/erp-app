import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Actor, Role } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { createContact } from './contacts';
import {
	createEmployee,
	employmentSchema,
	endEmployment,
	getEmployee,
	listEmployees,
	rehire,
	searchContactCandidates,
	updateEmployee
} from './employees';

const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
});

const carlos = {
	phone: '315 284 7710',
	full_name: 'Carlos Vélez',
	document_id: '71.384.902',
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
	return database
		.prepare('select entity_type, entity_id, action, before, after from events order by id')
		.all();
}

function count(table: string) {
	return database.prepare(`select count(*) as count from ${table}`).get()?.count;
}

const jorge = { phone: '300 771 2043', full_name: 'Jorge Iván Betancur', document_id: '71234567' };

test('without a picked contact, the contact and the employee in one batch, each with its CREATED event', async () => {
	const id = await hire();
	expect(await getEmployee(db, id, manager)).toEqual({
		id,
		phone: '573152847710',
		fullName: 'Carlos Vélez',
		idNumber: '71384902',
		monthlySalary: 1423500,
		position: 'Bodega',
		salaryBankAccount: null,
		employment: [{ start: '2024-07-15', end: null }],
		isEmployed: true
	});
	const contact = database.prepare('select id, full_name, document_id from contacts').get();
	expect(contact).toEqual({ id: 1, full_name: 'Carlos Vélez', document_id: '71384902' });
	expect(database.prepare('select contact_id from employees').get()?.contact_id).toBe(1);
	expect(events()).toMatchObject([
		{ entity_type: 'CONTACT', entity_id: 1, action: 'CREATED' },
		{ entity_type: 'EMPLOYEE', entity_id: id, action: 'CREATED' }
	]);
});

test('a contact picked from the search is reused, its phone, name and ID number as typed', async () => {
	const jorgeContact = { phone: jorge.phone, full_name: 'Jorge Betancur', email: 'jorge@b.co' };
	await createContact(db, jorgeContact, manager);
	const candidate = {
		id: 1,
		fullName: 'Jorge Betancur',
		phone: '573007712043',
		documentId: null,
		isEmployee: false
	};
	for (const search of ['3007712043', 'betan', 'jorge@b']) {
		expect(await searchContactCandidates(db, search, manager)).toEqual([candidate]);
	}

	const id = await hire({ ...carlos, ...jorge, contact_id: '1' });
	expect(count('contacts')).toBe(1);
	expect(await getEmployee(db, id, manager)).toMatchObject({
		fullName: 'Jorge Iván Betancur',
		idNumber: '71234567'
	});
	const edited = events()[1];
	expect(edited).toMatchObject({ entity_type: 'CONTACT', entity_id: 1, action: 'EDITED' });
	expect(JSON.parse(String(edited.after))).toEqual({
		full_name: 'Jorge Iván Betancur',
		document_id: '71234567'
	});
	expect(await searchContactCandidates(db, '71.234', manager)).toMatchObject([
		{ isEmployee: true }
	]);
});

test("a contact that's already another employee's is refused naming them", async () => {
	await hire();
	const refusal = { ok: false, message: 'Carlos Vélez ya está en Personal' };
	expect(
		await createEmployee(db, { ...carlos, document_id: '1', contact_id: '1' }, manager)
	).toEqual(refusal);
	expect(count('employees')).toBe(1);
});

test('without a pick, a shared phone gets a contact of its own', async () => {
	await createContact(db, { phone: carlos.phone, full_name: 'Bodega Central' }, manager);
	await hire();
	expect(count('contacts')).toBe(2);
	expect(database.prepare('select contact_id from employees').get()?.contact_id).toBe(2);
});

test('the search needs three characters and never matches an automatic document', async () => {
	await createContact(db, { phone: jorge.phone, full_name: 'Jorge Betancur' }, manager);
	const automatic = String(database.prepare('select document_id from contacts').get()?.document_id);
	expect(await searchContactCandidates(db, 'jo', manager)).toEqual([]);
	expect(await searchContactCandidates(db, null, manager)).toEqual([]);
	expect(await searchContactCandidates(db, '- -', manager)).toEqual([]);
	expect(await searchContactCandidates(db, automatic.slice(1), manager)).toEqual([]);
});

test("an automatic document is not an employee's cédula", async () => {
	const result = await createEmployee(db, { ...carlos, document_id: '@ABCDEFGH' }, manager);
	expect(result).toMatchObject({ ok: false, errors: { document_id: 'Escribe la cédula real' } });
});

test('an ID number another contact has is refused naming that contact', async () => {
	await hire();
	const result = await createEmployee(
		db,
		{ ...carlos, ...jorge, document_id: '71384902' },
		manager
	);
	expect(result).toMatchObject({
		ok: false,
		errors: { document_id: 'Esa cédula o NIT ya es de Carlos Vélez' }
	});
	expect(count('contacts')).toBe(1);
});

test('phone, name and ID number are required', async () => {
	const result = await createEmployee(
		db,
		{ ...carlos, phone: '', full_name: ' ', document_id: '' },
		manager
	);
	expect(result).toMatchObject({
		ok: false,
		errors: {
			phone: 'Escribe el teléfono',
			full_name: 'Escribe el nombre completo',
			document_id: 'Escribe la cédula'
		}
	});
});

test('editing name, phone or ID number changes the contact, logged as CONTACT EDITED', async () => {
	const id = await hire();
	await updateEmployee(
		db,
		{ ...carlos, id, full_name: 'Carlos A. Vélez', phone: '315 284 7711' },
		manager
	);
	const edited = events()[2];
	expect(edited).toMatchObject({ entity_type: 'CONTACT', entity_id: 1, action: 'EDITED' });
	expect(JSON.parse(String(edited.before))).toEqual({
		phone: '573152847710',
		full_name: 'Carlos Vélez'
	});
	expect(JSON.parse(String(edited.after))).toEqual({
		phone: '573152847711',
		full_name: 'Carlos A. Vélez'
	});
	expect(events()).toHaveLength(3);
});

test("changing the phone to another contact's shares it, and the employee keeps its contact", async () => {
	const id = await hire();
	await createContact(db, jorge, manager);
	const result = await updateEmployee(db, { ...carlos, id, phone: jorge.phone }, manager);
	expect(result).toEqual({ ok: true, id });
	expect(await getEmployee(db, id, manager)).toMatchObject({
		phone: '573007712043',
		fullName: 'Carlos Vélez'
	});
});

test('the payroll account is optional, kept across employment changes and cleared when blanked', async () => {
	const id = await hire({
		...carlos,
		salary_bank_account: '  Bancolombia ahorros 123-456789-01 '
	});
	await endEmployment(db, { id, end: '2025-06-30' }, manager);
	expect((await getEmployee(db, id, manager))?.salaryBankAccount).toBe(
		'Bancolombia ahorros 123-456789-01'
	);
	const attributes = () =>
		JSON.parse(String(database.prepare('select attributes from employees').get()?.attributes));
	expect(attributes()).toHaveProperty('salary_bank_account');
	expect(attributes()).not.toHaveProperty('bank_account');

	await updateEmployee(db, { ...carlos, id, salary_bank_account: '' }, manager);
	expect((await getEmployee(db, id, manager))?.salaryBankAccount).toBeNull();
	expect(attributes()).not.toHaveProperty('salary_bank_account');
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
	expect(count('employees')).toBe(1);
	expect(events().map((row) => row.action)).toEqual(['CREATED', 'CREATED', 'EDITED', 'EDITED']);
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
	const salamanca = { phone: '3001112233', full_name: 'Jorge Salamanca', document_id: '98552017' };
	const gone = await hire({ ...carlos, ...salamanca });
	await endEmployment(db, { id: gone, end: '2026-03-31' }, manager);
	await hire();
	await hire({ ...carlos, phone: '3104428890', full_name: 'Ana Pérez', document_id: '1036452118' });
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
