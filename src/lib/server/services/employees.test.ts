import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Role } from '$lib/roles';
import { actorWith, createFixture, MANAGER } from '../db/fixture';
import { generateDocumentId, newClientStatements } from './contacts';
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

let fixture: ReturnType<typeof createFixture>;
let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	fixture = createFixture();
	({ db, database } = fixture);
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
	const result = await createEmployee(db, input, MANAGER);
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

// Jorge as «Cliente nuevo» on the order form leaves him: an automatic document.
async function newClient(): Promise<void> {
	const client = {
		phone: '573007712043',
		whatsapp: null,
		fullName: 'Jorge Betancur',
		documentId: generateDocumentId()
	};
	await db.batch(newClientStatements(db, MANAGER, client));
}

test('without a picked contact, the contact and the employee in one batch, each with its CREATED event', async () => {
	const id = await hire();
	const contacts = database.prepare('select id, full_name, document_id from contacts').all();
	expect(contacts).toHaveLength(1);
	const [contact] = contacts;
	const contactId = Number(contact.id);
	expect(await getEmployee(db, id, MANAGER)).toEqual({
		id,
		contactId,
		phone: '573152847710',
		whatsapp: null,
		fullName: 'Carlos Vélez',
		idNumber: '71384902',
		monthlySalary: 1423500,
		position: 'Bodega',
		salaryBankAccount: null,
		employment: [{ start: '2024-07-15', end: null }],
		isEmployed: true
	});
	expect(contact).toEqual({ id: contactId, full_name: 'Carlos Vélez', document_id: '71384902' });
	expect(events()).toMatchObject([
		{ entity_type: 'CONTACT', entity_id: contactId, action: 'CREATED' },
		{ entity_type: 'EMPLOYEE', entity_id: id, action: 'CREATED' }
	]);
});

test('a contact picked from the search is reused, its phone, name and ID number as typed', async () => {
	const jorgeId = await fixture.contact({
		full_name: 'Jorge Betancur',
		phone: '300 771 2043',
		document_id: '71234560',
		email: 'jorge@b.co'
	});
	const candidate = {
		id: jorgeId,
		fullName: 'Jorge Betancur',
		phone: '573007712043',
		whatsapp: null,
		documentId: '71234560',
		isEmployee: false
	};
	for (const search of ['3007712043', 'betan', 'jorge@b']) {
		expect(await searchContactCandidates(db, search, MANAGER)).toEqual([candidate]);
	}

	const id = await hire({ ...carlos, ...jorge, contact_id: String(jorgeId) });
	expect(count('contacts')).toBe(1);
	expect(await getEmployee(db, id, MANAGER)).toMatchObject({
		fullName: 'Jorge Iván Betancur',
		idNumber: '71234567'
	});
	const edited = events()[1];
	expect(edited).toMatchObject({ entity_type: 'CONTACT', entity_id: jorgeId, action: 'EDITED' });
	expect(JSON.parse(String(edited.after))).toEqual({
		full_name: 'Jorge Iván Betancur',
		document_id: '71234567'
	});
	expect(await searchContactCandidates(db, '71.234', MANAGER)).toMatchObject([
		{ isEmployee: true }
	]);
});

test('a new contact gets its name capitalized; a picked one keeps the name as typed', async () => {
	const created = await hire({ ...carlos, full_name: 'carlos vélez' });
	expect((await getEmployee(db, created, MANAGER))?.fullName).toBe('Carlos Vélez');
	await newClient();
	const [client] = await searchContactCandidates(db, '3007712043', MANAGER);
	const picked = await hire({
		...carlos,
		...jorge,
		full_name: 'jorge iván betancur',
		contact_id: String(client.id)
	});
	expect((await getEmployee(db, picked, MANAGER))?.fullName).toBe('jorge iván betancur');
});

test("a contact that's already another employee's is refused naming them", async () => {
	const employee = await getEmployee(db, await hire(), MANAGER);
	const picked = { ...carlos, document_id: '1', contact_id: String(employee?.contactId) };
	const refusal = { ok: false, message: 'Carlos Vélez ya está en Personal', errors: {} };
	expect(await createEmployee(db, picked, MANAGER)).toEqual(refusal);
	expect(count('employees')).toBe(1);
});

test('without a pick, a shared phone gets a contact of its own', async () => {
	const bodega = { phone: carlos.phone, full_name: 'Bodega Central', document_id: '900111222' };
	const shared = await fixture.contact(bodega);
	const id = await hire();
	expect(count('contacts')).toBe(2);
	expect((await getEmployee(db, id, MANAGER))?.contactId).not.toBe(shared);
});

test('letters also find the username, without the @ and ignoring case', async () => {
	const luz = { full_name: 'Mayra Castaño', document_id: '1040338912', whatsapp: 'LuzMarinaR' };
	await fixture.contact(luz);
	for (const search of ['luzma', '@LUZMA']) {
		expect(await searchContactCandidates(db, search, MANAGER)).toMatchObject([
			{ fullName: 'Mayra Castaño', whatsapp: 'LuzMarinaR' }
		]);
	}
	expect(await searchContactCandidates(db, '@luz.ma', MANAGER)).toEqual([]);
});

test('the search needs three characters and never matches an automatic document', async () => {
	await newClient();
	const automatic = String(database.prepare('select document_id from contacts').get()?.document_id);
	expect(await searchContactCandidates(db, 'jo', MANAGER)).toEqual([]);
	expect(await searchContactCandidates(db, null, MANAGER)).toEqual([]);
	expect(await searchContactCandidates(db, '- -', MANAGER)).toEqual([]);
	expect(await searchContactCandidates(db, automatic.slice(1), MANAGER)).toEqual([]);
});

test("an automatic document is not an employee's cédula", async () => {
	const result = await createEmployee(db, { ...carlos, document_id: '@ABCDEFGH' }, MANAGER);
	expect(result).toMatchObject({ ok: false, errors: { document_id: 'Escribe la cédula real' } });
});

test('an ID number another contact has is refused naming that contact', async () => {
	await hire();
	const result = await createEmployee(
		db,
		{ ...carlos, ...jorge, document_id: '71384902' },
		MANAGER
	);
	expect(result).toMatchObject({
		ok: false,
		errors: { document_id: 'Esa cédula o NIT ya es de Carlos Vélez' }
	});
	expect(count('contacts')).toBe(1);
});

test('name and ID number are required; the phone and the username are not', async () => {
	const result = await createEmployee(
		db,
		{ ...carlos, phone: '', full_name: ' ', document_id: '' },
		MANAGER
	);
	expect(result).toEqual({
		ok: false,
		message: 'Revisa los campos marcados en rojo antes de guardar.',
		errors: {
			full_name: 'Escribe el nombre completo',
			document_id: 'Escribe la cédula'
		}
	});
	const id = await hire({ ...carlos, phone: '', whatsapp: '' });
	expect(await getEmployee(db, id, MANAGER)).toMatchObject({ phone: null, whatsapp: null });
});

test("the username is saved on the employee's contact, its change logged with before and after", async () => {
	const id = await hire({ ...carlos, whatsapp: '@CarlosVelez' });
	expect(await getEmployee(db, id, MANAGER)).toMatchObject({ whatsapp: 'CarlosVelez' });
	await updateEmployee(db, { ...carlos, id, whatsapp: 'wa.me/CVelez_' }, MANAGER);
	expect(await getEmployee(db, id, MANAGER)).toMatchObject({ whatsapp: 'CVelez_' });
	const edited = events().at(-1)!;
	expect(edited).toMatchObject({ entity_type: 'CONTACT', action: 'EDITED' });
	expect(JSON.parse(String(edited.before))).toEqual({ whatsapp: 'CarlosVelez' });
	expect(JSON.parse(String(edited.after))).toEqual({ whatsapp: 'CVelez_' });
});

test('an invalid username is a field error on the employee form', async () => {
	const result = await createEmployee(db, { ...carlos, whatsapp: 'may..c' }, MANAGER);
	expect(result).toMatchObject({
		ok: false,
		errors: { whatsapp: 'Escriba el usuario como aparece en WhatsApp, por ejemplo @mayc47.' }
	});
});

test('picking a contact fills in its username', async () => {
	await fixture.contact({
		full_name: 'Jorge Betancur',
		phone: '',
		whatsapp: '@JorgeB',
		document_id: '71234567'
	});
	expect(await searchContactCandidates(db, 'betan', MANAGER)).toMatchObject([
		{ phone: null, whatsapp: 'JorgeB' }
	]);
});

test('editing name, phone or ID number changes the contact, logged as CONTACT EDITED', async () => {
	const id = await hire();
	await updateEmployee(
		db,
		{ ...carlos, id, full_name: 'Carlos A. Vélez', phone: '315 284 7711' },
		MANAGER
	);
	const { contactId } = (await getEmployee(db, id, MANAGER))!;
	const edited = events()[2];
	expect(edited).toMatchObject({ entity_type: 'CONTACT', entity_id: contactId, action: 'EDITED' });
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
	await fixture.contact(jorge);
	const result = await updateEmployee(db, { ...carlos, id, phone: jorge.phone }, MANAGER);
	expect(result).toEqual({ ok: true, id });
	expect(await getEmployee(db, id, MANAGER)).toMatchObject({
		phone: '573007712043',
		fullName: 'Carlos Vélez'
	});
});

test('the payroll account is optional, kept across employment changes and cleared when blanked', async () => {
	const id = await hire({
		...carlos,
		salary_bank_account: '  Bancolombia ahorros 123-456789-01 '
	});
	await endEmployment(db, { id, end: '2025-06-30' }, MANAGER);
	expect((await getEmployee(db, id, MANAGER))?.salaryBankAccount).toBe(
		'Bancolombia ahorros 123-456789-01'
	);
	const attributes = () =>
		JSON.parse(String(database.prepare('select attributes from employees').get()?.attributes));
	expect(attributes()).toHaveProperty('salary_bank_account');
	expect(attributes()).not.toHaveProperty('bank_account');

	await updateEmployee(db, { ...carlos, id, salary_bank_account: '' }, MANAGER);
	expect((await getEmployee(db, id, MANAGER))?.salaryBankAccount).toBeNull();
	expect(attributes()).not.toHaveProperty('salary_bank_account');
});

test('ending sets the last period end; rehiring appends a period to the same row', async () => {
	const id = await hire();
	expect((await endEmployment(db, { id, end: '2025-06-30' }, MANAGER)).ok).toBe(true);
	expect((await getEmployee(db, id, MANAGER))?.isEmployed).toBe(false);

	const early = await rehire(db, { id, start: '2025-06-30' }, MANAGER);
	expect(early).toEqual({
		ok: false,
		message: 'La fecha de ingreso debe ser posterior al último retiro',
		errors: {}
	});
	expect((await rehire(db, { id, start: '2026-01-13' }, MANAGER)).ok).toBe(true);

	expect((await getEmployee(db, id, MANAGER))?.employment).toEqual([
		{ start: '2024-07-15', end: '2025-06-30' },
		{ start: '2026-01-13', end: null }
	]);
	expect(count('employees')).toBe(1);
	expect(events().map((row) => row.action)).toEqual(['CREATED', 'CREATED', 'EDITED', 'EDITED']);
});

test('an employment cannot end before it started', async () => {
	const id = await hire();
	const result = await endEmployment(db, { id, end: '2024-07-14' }, MANAGER);
	expect(result).toEqual({
		ok: false,
		message: 'La fecha de retiro no puede ser anterior al ingreso',
		errors: {}
	});
});

test('a missing end or rehire date is marked on its field under the default banner', async () => {
	const id = await hire();
	expect(await endEmployment(db, { id, end: '' }, MANAGER)).toEqual({
		ok: false,
		message: 'Revisa los campos marcados en rojo antes de guardar.',
		errors: { end: 'Escoge la fecha de retiro' }
	});
	await endEmployment(db, { id, end: '2025-06-30' }, MANAGER);
	expect(await rehire(db, { id, start: '' }, MANAGER)).toEqual({
		ok: false,
		message: 'Revisa los campos marcados en rojo antes de guardar.',
		errors: { start: 'Escoge la fecha de ingreso' }
	});
});

test('the list puts the currently employed first, by name', async () => {
	const salamanca = { phone: '3001112233', full_name: 'Jorge Salamanca', document_id: '98552017' };
	const gone = await hire({ ...carlos, ...salamanca });
	await endEmployment(db, { id: gone, end: '2026-03-31' }, MANAGER);
	await hire();
	await hire({ ...carlos, phone: '3104428890', full_name: 'Ana Pérez', document_id: '1036452118' });
	const names = (await listEmployees(db, MANAGER)).map((employee) => employee.fullName);
	expect(names).toEqual(['Ana Pérez', 'Carlos Vélez', 'Jorge Salamanca']);
});

test('SALES, WAREHOUSE and DRIVER get a 403', async () => {
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		await expect(listEmployees(db, actorWith(role))).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
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
