import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Actor, Role } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import {
	contactAttributesSchema,
	createContact,
	generateDocumentId,
	getContact,
	listContacts,
	servicesSchema,
	updateContact
} from './contacts';
import { createEmployee } from './employees';

function actorWith(role: Role): Actor {
	return { username: role.toLowerCase(), employeeId: null, roles: [role], kind: 'user' };
}

const manager = actorWith('MANAGER');
const sales = actorWith('SALES');

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
});

const luzMarina = { phone: '310 442 8890', full_name: 'Luz Marina Restrepo' };

async function create(input: Record<string, unknown>, actor: Actor = manager): Promise<number> {
	const result = await createContact(db, input, actor);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.id;
}

async function rejection(promise: Promise<unknown>): Promise<number | null> {
	try {
		await promise;
		return null;
	} catch (thrown) {
		return isHttpError(thrown) ? thrown.status : null;
	}
}

test('attributes take only their five keys: {} is valid, an unknown key is rejected', () => {
	expect(contactAttributesSchema.safeParse({}).success).toBe(true);
	expect(contactAttributesSchema.safeParse({ email: 'a@b.co', notes: 'Tarde' }).success).toBe(true);
	expect(contactAttributesSchema.safeParse({ nickname: 'Lucho' }).success).toBe(false);
	expect(contactAttributesSchema.safeParse({ notes: '' }).success).toBe(false);
});

test('services: no duplicates, only the fixed list, [] is valid', () => {
	expect(servicesSchema.safeParse([]).success).toBe(true);
	expect(servicesSchema.safeParse(['TRANSPORTER', 'CHEF']).success).toBe(true);
	expect(servicesSchema.safeParse(['CHEF', 'CHEF']).success).toBe(false);
	expect(servicesSchema.safeParse(['PHOTOGRAPHER']).success).toBe(false);
});

test('a contact saves its phone normalized and its optional fields in attributes', async () => {
	const id = await create({
		...luzMarina,
		document_id: '1.036.452.118',
		email: 'luzmarina.r@gmail.com',
		address_1: 'Cra 43A #18-95',
		address_2: '',
		services: ['DECORATOR']
	});
	expect(await getContact(db, id, sales)).toEqual({
		id,
		phone: '573104428890',
		fullName: 'Luz Marina Restrepo',
		documentId: '1036452118',
		services: ['DECORATOR'],
		email: 'luzmarina.r@gmail.com',
		address1: 'Cra 43A #18-95',
		address2: null,
		bankAccount: null,
		notes: null,
		isEmployee: false
	});
	expect(database.prepare('select action, before from events').all()).toMatchObject([
		{ action: 'CREATED', before: null }
	]);
});

test('a phone that is not valid, or a missing name, comes back on its field', async () => {
	const result = await createContact(db, { phone: '442 8890', full_name: ' ' }, sales);
	expect(result).toMatchObject({
		ok: false,
		errors: {
			phone: expect.stringContaining('Número no válido'),
			full_name: 'Escribe el nombre'
		}
	});
});

test('the email is validated only when it has a value', async () => {
	const result = await createContact(db, { ...luzMarina, email: 'luzmarina' }, sales);
	expect(result).toMatchObject({ ok: false, errors: { email: expect.any(String) } });
	expect((await createContact(db, { ...luzMarina, email: '' }, sales)).ok).toBe(true);
});

test("a company's branches share its switchboard: two contacts can have one phone", async () => {
	await create({ ...luzMarina, document_id: '900.456.123-4' });
	await create({
		phone: '+57 3104428890',
		full_name: 'Sucursal Centro',
		document_id: '9004561235'
	});
	expect((await listContacts(db, { search: '442 8890' }, sales)).contacts).toHaveLength(2);
});

test('the automatic document is @ and 8 symbols of Crockford base32', () => {
	expect(generateDocumentId()).toMatch(/^@[0-9A-HJKMNP-TV-Z]{8}$/);
	expect(generateDocumentId()).not.toBe(generateDocumentId());
});

test('one document per contact; one not given is made up, and not typed as such', async () => {
	await create({ ...luzMarina, document_id: '1.036.452.118' });
	const result = await createContact(
		db,
		{ phone: '300 771 2043', full_name: 'Jorge Iván Betancur', document_id: '1036452118' },
		manager
	);
	expect(result).toMatchObject({
		ok: false,
		errors: { document_id: 'Esa cédula o NIT ya es de Luz Marina Restrepo' }
	});
	const jorge = await create({ phone: '300 771 2043', full_name: 'Jorge Iván Betancur' });
	const wilson = await create({
		phone: '311 908 5512',
		full_name: 'Wilson Muñoz',
		document_id: ''
	});
	const documentOf = async (id: number) => (await getContact(db, id, sales))?.documentId;
	expect(await documentOf(jorge)).toMatch(/^@.{8}$/);
	expect(await documentOf(jorge)).not.toBe(await documentOf(wilson));
	expect(
		await createContact(db, { ...luzMarina, document_id: '@ABCDEFGH' }, manager)
	).toMatchObject({ ok: false, errors: { document_id: expect.stringContaining('automáticos') } });
	expect(() =>
		database
			.prepare(
				`insert into contacts (phone, full_name, document_id, created_at, created_by, updated_at, updated_by)
				values ('13055550142', 'Tourist', '1036452118', 0, 'test', 0, 'test')`
			)
			.run()
	).toThrow(/UNIQUE/);
	expect(() =>
		database
			.prepare(
				`insert into contacts (phone, full_name, created_at, created_by, updated_at, updated_by)
				values ('13055550142', 'Tourist', 0, 'test', 0, 'test')`
			)
			.run()
	).toThrow(/NOT NULL/);
});

test('search by name or by three digits of the phone, with the service filter, a page at a time', async () => {
	await create({ phone: '300 771 2043', full_name: 'Jorge Iván Betancur' });
	await create({ ...luzMarina, services: ['DECORATOR'] });
	await create({ phone: '311 908 5512', full_name: 'Wilson Muñoz', services: ['TRANSPORTER'] });
	const names = async (input: Record<string, unknown>) =>
		(await listContacts(db, input, sales)).contacts.map((contact) => contact.fullName);

	expect(await names({})).toEqual(['Jorge Iván Betancur', 'Luz Marina Restrepo', 'Wilson Muñoz']);
	expect(await names({ search: 'marina' })).toEqual(['Luz Marina Restrepo']);
	expect(await names({ search: '442 8890' })).toEqual(['Luz Marina Restrepo']);
	expect(await names({ search: '44' })).toHaveLength(3);
	expect(await names({ service: 'TRANSPORTER' })).toEqual(['Wilson Muñoz']);
	expect(await names({ service: 'TRANSPORTER', search: 'luz' })).toEqual([]);
	expect(await names({ service: 'BOGUS', pages: 'x' })).toHaveLength(3);

	for (let i = 0; i < 9; i++) {
		await create({ phone: `320 000 00${10 + i}`, full_name: `Zoila ${i}` });
	}
	const first = await listContacts(db, {}, sales);
	expect(first).toMatchObject({ hasMore: true });
	expect(first.contacts).toHaveLength(10);
	const more = await listContacts(db, { pages: '2' }, sales);
	expect(more.contacts.slice(10).map((contact) => contact.fullName)).toEqual([
		'Zoila 7',
		'Zoila 8'
	]);
	expect(more.hasMore).toBe(false);
	// Past the cap, a typed URL gets the first page, never the whole table.
	expect((await listContacts(db, { pages: '1000' }, sales)).contacts).toHaveLength(10);
});

const withAccount = {
	...luzMarina,
	document_id: '1036452118',
	bank_account: 'Nequi 310 442 8890',
	services: ['DECORATOR']
};

test('Sales is rejected changing services, a set bank account or the document', async () => {
	const id = await create(withAccount);
	for (const change of [
		{ services: [] },
		{ bank_account: 'Bancolombia 123' },
		{ bank_account: '' },
		{ document_id: '71384902' }
	]) {
		expect(await rejection(updateContact(db, { ...withAccount, ...change, id }, sales))).toBe(403);
	}
	expect(await rejection(createContact(db, { ...withAccount, phone: '3007712043' }, sales))).toBe(
		403
	);
});

test('Sales fills in an empty bank account but never assigns a document', async () => {
	const id = await create(luzMarina, sales);
	const automatic = (await getContact(db, id, sales))!.documentId;
	const kept = { ...luzMarina, document_id: automatic, bank_account: 'Nequi 310 442 8890' };
	expect(await updateContact(db, { ...kept, id }, sales)).toEqual({ ok: true, id });
	expect(
		await rejection(updateContact(db, { ...kept, document_id: '1036452118', id }, sales))
	).toBe(403);
	expect(
		await rejection(createContact(db, { ...luzMarina, document_id: '1036452118' }, sales))
	).toBe(403);
});

test('Manager assigns a real document over the automatic one, and clearing it makes a new one', async () => {
	const id = await create(luzMarina);
	const automatic = (await getContact(db, id, manager))!.documentId;
	await updateContact(db, { ...luzMarina, document_id: automatic, id }, manager);
	expect((await getContact(db, id, manager))?.documentId).toBe(automatic);
	await updateContact(db, { ...luzMarina, document_id: '1.036.452.118', id }, manager);
	expect((await getContact(db, id, manager))?.documentId).toBe('1036452118');
	await updateContact(db, { ...luzMarina, document_id: '', bank_account: '', id }, manager);
	expect(await getContact(db, id, manager)).toMatchObject({
		documentId: expect.stringMatching(/^@/),
		bankAccount: null
	});
});

test("an employee's document is Manager's and Admin's, and never left empty", async () => {
	const ana = { phone: '310 442 8890', full_name: 'Ana Pérez', document_id: '1036452118' };
	const hired = { ...ana, monthly_salary: '1750905', position: 'Bodega', start: '2026-07-01' };
	await createEmployee(db, hired, manager);
	const id = 1;
	expect(await getContact(db, id, sales)).toMatchObject({ isEmployee: true });
	expect((await listContacts(db, {}, sales)).contacts).toMatchObject([{ isEmployee: true }]);
	expect(await rejection(updateContact(db, { ...ana, document_id: '1', id }, sales))).toBe(403);
	expect(await updateContact(db, { ...ana, full_name: 'Ana P.', id }, sales)).toEqual({
		ok: true,
		id
	});
	expect(await updateContact(db, { ...ana, document_id: '', id }, manager)).toMatchObject({
		ok: false,
		errors: { document_id: 'Es empleado: la cédula no puede quedar vacía' }
	});
});

test('an edit logs only the changed attributes key, old and new', async () => {
	const id = await create({ ...withAccount, notes: 'Llamar tarde' });
	await updateContact(
		db,
		{ ...withAccount, notes: 'Llamar tarde', bank_account: 'Daviplata 1', id },
		manager
	);
	const edit = database.prepare("select before, after from events where action = 'EDITED'").all();
	expect(
		edit.map(({ before, after }) => [JSON.parse(String(before)), JSON.parse(String(after))])
	).toEqual([
		[
			{ 'attributes.bank_account': 'Nequi 310 442 8890' },
			{ 'attributes.bank_account': 'Daviplata 1' }
		]
	]);
});

test('an edit that changes nothing writes nothing', async () => {
	const id = await create(withAccount);
	await updateContact(db, { ...withAccount, phone: '+57 310 442 8890', id }, sales);
	expect(database.prepare('select count(*) as count from events').get()).toEqual({ count: 1 });
});

test('Warehouse and Driver have no access to contacts', async () => {
	for (const role of ['WAREHOUSE', 'DRIVER'] as const) {
		expect(await rejection(listContacts(db, {}, actorWith(role)))).toBe(403);
		expect(await rejection(createContact(db, luzMarina, actorWith(role)))).toBe(403);
	}
});
