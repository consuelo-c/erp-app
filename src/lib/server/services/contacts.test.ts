import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Actor, Role } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import {
	contactAttributesSchema,
	createContact,
	findWhatsappOwner,
	generateDocumentId,
	getContact,
	listContacts,
	listTransporters,
	newClientStatements,
	searchClients,
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

// Contactos always asks for one: each contact a test creates gets its own unless it types one.
let documents = 0;

async function create(input: Record<string, unknown>, actor: Actor = manager): Promise<number> {
	documents += 1;
	const result = await createContact(
		db,
		{ document_id: String(70000000 + documents), ...input },
		actor
	);
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
	expect(servicesSchema.safeParse(['TRANSPORTER', 'WEDDING_PLANNER']).success).toBe(true);
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
		whatsapp: null,
		fullName: 'Luz Marina Restrepo',
		documentId: '1036452118',
		services: ['DECORATOR'],
		email: 'luzmarina.r@gmail.com',
		address1: 'Cra 43A #18-95',
		address2: null,
		bankAccount: null,
		notes: null,
		hasAutoDocument: false,
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

test.each([
	['a phone only', { phone: '310 442 8890' }, { phone: '573104428890', whatsapp: null }],
	['a username only', { whatsapp: '@LuzMarinaR' }, { phone: null, whatsapp: 'LuzMarinaR' }],
	[
		'both',
		{ phone: '310 442 8890', whatsapp: 'wa.me/LuzMarinaR' },
		{ phone: '573104428890', whatsapp: 'LuzMarinaR' }
	],
	['neither', { phone: '', whatsapp: ' ' }, { phone: null, whatsapp: null }]
])('a contact saves with %s', async (_, typed, saved) => {
	const id = await create({ full_name: 'Luz Marina Restrepo', ...typed });
	expect(await getContact(db, id, sales)).toMatchObject(saved);
});

test('a username that is not valid comes back on its field', async () => {
	const result = await createContact(db, { ...luzMarina, whatsapp: 'mayc.com' }, sales);
	expect(result).toMatchObject({
		ok: false,
		errors: { whatsapp: 'Escriba el usuario como aparece en WhatsApp, por ejemplo @mayc47.' }
	});
});

test('a username another contact has, in any case, is named for the warning and still saves', async () => {
	const luz = await create({ ...luzMarina, whatsapp: 'LuzMarinaR' });
	const input = { whatsapp: '@luzmarinar', exceptId: null };
	expect(await findWhatsappOwner(db, input, sales)).toBe('Luz Marina Restrepo');
	const other = await create({ full_name: 'Luz Marina Arango', whatsapp: 'luzmarinar' });
	expect(await getContact(db, other, sales)).toMatchObject({ whatsapp: 'luzmarinar' });
	// The contact's own username doesn't count; an invalid or missing one names no one.
	expect(await findWhatsappOwner(db, { whatsapp: 'LuzMarinaR', exceptId: other }, sales)).toBe(
		'Luz Marina Restrepo'
	);
	expect(await findWhatsappOwner(db, { whatsapp: 'nadie', exceptId: luz }, sales)).toBeNull();
	expect(await findWhatsappOwner(db, { whatsapp: 'may..c', exceptId: null }, sales)).toBeNull();
	expect(await findWhatsappOwner(db, { whatsapp: null, exceptId: null }, sales)).toBeNull();
	const driver = actorWith('DRIVER');
	expect(await rejection(findWhatsappOwner(db, input, driver))).toBe(403);
});

test("changing a contact's username logs it with before and after", async () => {
	const id = await create({ ...luzMarina, document_id: '1036452118', whatsapp: 'LuzMarinaR' });
	const edit = { ...luzMarina, id, document_id: '1036452118', whatsapp: '@LuzMarina_R' };
	expect(await updateContact(db, edit, sales)).toEqual({ ok: true, id });
	const edited = database.prepare("select before, after from events where action = 'EDITED'").get();
	expect(JSON.parse(String(edited?.before))).toEqual({ whatsapp: 'LuzMarinaR' });
	expect(JSON.parse(String(edited?.after))).toEqual({ whatsapp: 'LuzMarina_R' });
});

test('the email is validated only when it has a value', async () => {
	const typed = { ...luzMarina, document_id: '1036452118' };
	const result = await createContact(db, { ...typed, email: 'luzmarina' }, sales);
	expect(result).toMatchObject({ ok: false, errors: { email: expect.any(String) } });
	expect((await createContact(db, { ...typed, email: '' }, sales)).ok).toBe(true);
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

test('one document per contact, never typed as an automatic one', async () => {
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

const DOCUMENT_REQUIRED = { ok: false, errors: { document_id: 'Escribe la cédula o NIT' } };

test('Contactos never creates a contact without a real document', async () => {
	for (const documentId of [undefined, '', ' . - ']) {
		const typed = { ...luzMarina, document_id: documentId };
		expect(await createContact(db, typed, manager)).toMatchObject(DOCUMENT_REQUIRED);
	}
	expect(database.prepare('select count(*) as count from contacts').get()).toEqual({ count: 0 });
});

/** A contact as «Cliente nuevo» on the order form leaves it: an automatic document. */
async function newClient(): Promise<{ id: number; automatic: string }> {
	const automatic = generateDocumentId();
	const client = { phone: '573104428890', fullName: 'Luz Marina Restrepo', documentId: automatic };
	const [inserted] = await db.batch(newClientStatements(db, sales, client));
	return { id: inserted.meta.last_row_id, automatic };
}

test('Contactos never saves an edit that leaves the document empty or still automatic', async () => {
	const { id, automatic } = await newClient();
	expect(await getContact(db, id, sales)).toMatchObject({ hasAutoDocument: true });
	for (const documentId of ['', automatic]) {
		for (const actor of [sales, manager]) {
			const typed = { ...luzMarina, document_id: documentId, id };
			expect(await updateContact(db, typed, actor)).toMatchObject(
				'' === documentId
					? DOCUMENT_REQUIRED
					: { ok: false, errors: { document_id: expect.stringContaining('automático') } }
			);
		}
	}
	const real = await create({ ...luzMarina, document_id: '1036452118' });
	expect(
		await updateContact(db, { ...luzMarina, document_id: '', id: real }, manager)
	).toMatchObject(DOCUMENT_REQUIRED);
	expect((await getContact(db, real, manager))?.documentId).toBe('1036452118');
});

test('Sales types the real document over an automatic one, and on a new contact', async () => {
	const { id } = await newClient();
	const typed = { ...luzMarina, document_id: '1.036.452.118', id };
	expect(await updateContact(db, typed, sales)).toEqual({ ok: true, id });
	expect(await getContact(db, id, sales)).toMatchObject({
		documentId: '1036452118',
		hasAutoDocument: false
	});
	const edited = database.prepare("select before, after from events where action = 'EDITED'").get();
	expect(JSON.parse(String(edited?.after))).toEqual({ document_id: '1036452118' });
	const jorge = {
		phone: '300 771 2043',
		full_name: 'Jorge Iván Betancur',
		document_id: '71234567'
	};
	const created = await createContact(db, jorge, sales);
	expect(created).toMatchObject({ ok: true });
});

test('once real, only Manager and Admin change the document: Sales gets a 403', async () => {
	const id = await create({ ...luzMarina, document_id: '1036452118' }, sales);
	const kept = { ...luzMarina, document_id: '1.036.452.118', bank_account: 'Nequi 310 442 8890' };
	expect(await updateContact(db, { ...kept, id }, sales)).toEqual({ ok: true, id });
	expect(await rejection(updateContact(db, { ...kept, document_id: '71384902', id }, sales))).toBe(
		403
	);
	for (const [actor, documentId] of [
		[manager, '71384902'],
		[actorWith('ADMIN'), '900.312.554-1']
	] as const) {
		const changed = { ...kept, document_id: documentId, id };
		expect(await updateContact(db, changed, actor)).toEqual({ ok: true, id });
	}
	expect((await getContact(db, id, manager))?.documentId).toBe('9003125541');
});

test('search by name or by three digits of the phone, with the service filter, a page at a time', async () => {
	await create({ phone: '300 771 2043', full_name: 'Jorge Iván Betancur' });
	await create({ ...luzMarina, services: ['DECORATOR'] });
	await create({ phone: '311 908 5512', full_name: 'Wilson Muñoz', services: ['TRANSPORTER'] });
	const names = async (input: Record<string, unknown>) =>
		(await listContacts(db, input, sales)).contacts.map((contact) => contact.fullName);

	expect(await names({})).toEqual(['Jorge Iván Betancur', 'Luz Marina Restrepo', 'Wilson Muñoz']);
	expect(await names({ search: 'marina' })).toEqual(['Luz Marina Restrepo']);
	expect(await names({ search: 'réstrepo  LUZ' })).toEqual(['Luz Marina Restrepo']);
	expect(await names({ search: '442 8890' })).toEqual(['Luz Marina Restrepo']);
	expect(await names({ search: '44' })).toHaveLength(3);
	expect(await names({ service: 'TRANSPORTER' })).toEqual(['Wilson Muñoz']);
	expect(await names({ service: 'TRANSPORTER', search: 'luz' })).toEqual([]);
	expect(await names({ service: 'BOGUS', page: 'x' })).toHaveLength(3);

	for (let i = 0; i < 19; i++) {
		await create({ phone: `320 000 00${10 + i}`, full_name: `Zoila ${i}` });
	}
	const first = await listContacts(db, {}, sales);
	expect(first).toMatchObject({ total: 22, pageCount: 2, filters: { page: 1 } });
	expect(first.contacts).toHaveLength(20);
	const second = await listContacts(db, { page: '2' }, sales);
	expect(second.contacts.map((contact) => contact.fullName)).toEqual(['Zoila 8', 'Zoila 9']);
	// Past the last page, a typed URL gets the last one.
	expect((await listContacts(db, { page: '1000' }, sales)).filters.page).toBe(2);
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

test("an employee's document is Manager's and Admin's, and never left empty", async () => {
	const ana = { phone: '310 442 8890', full_name: 'Ana Pérez', document_id: '1036452118' };
	const hired = { ...ana, monthly_salary: '1750905', position: 'Bodega', start: '2026-07-01' };
	await createEmployee(db, hired, manager);
	const id = 1;
	expect(await getContact(db, id, sales)).toMatchObject({ isEmployee: true });
	expect((await listContacts(db, {}, sales)).contacts).toMatchObject([{ isEmployee: true }]);
	await create({ phone: '300 771 2043', full_name: 'Jorge Iván Betancur' });
	expect((await listContacts(db, { service: 'EMPLOYEE' }, sales)).contacts).toMatchObject([
		{ fullName: 'Ana Pérez' }
	]);
	expect(await rejection(updateContact(db, { ...ana, document_id: '1', id }, sales))).toBe(403);
	expect(await updateContact(db, { ...ana, full_name: 'Ana P.', id }, sales)).toEqual({
		ok: true,
		id
	});
	expect(await updateContact(db, { ...ana, document_id: '', id }, manager)).toMatchObject(
		DOCUMENT_REQUIRED
	);
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

test('the order form finds clients by name, address or phone, by name, with their address', async () => {
	const company = { ...luzMarina, full_name: 'Eventos Restrepo S.A.S.', document_id: '900312554' };
	const companyId = await create(company);
	const luzMarinaId = await create({
		...luzMarina,
		address_1: 'Cra 43A #18-95, El Poblado',
		address_2: 'Piso 2'
	});
	await create({ phone: '311 222 3344', full_name: 'Otro' });
	const ids = async (typed: string) =>
		(await searchClients(db, typed, sales)).map((client) => client.id);
	expect(await searchClients(db, '+57 310 442 8890', sales)).toEqual([
		{
			id: companyId,
			fullName: 'Eventos Restrepo S.A.S.',
			phone: '573104428890',
			address1: null,
			address2: null
		},
		{
			id: luzMarinaId,
			fullName: 'Luz Marina Restrepo',
			phone: '573104428890',
			address1: 'Cra 43A #18-95, El Poblado',
			address2: 'Piso 2'
		}
	]);
	expect(await ids('restrepo')).toEqual([companyId, luzMarinaId]);
	expect(await ids('poblado MARINA')).toEqual([luzMarinaId]);
	expect(await ids('piso 2')).toEqual([luzMarinaId]);
	expect(await ids('44')).toEqual([]);
	expect(await rejection(searchClients(db, 'luz', actorWith('WAREHOUSE')))).toBe(403);
});

test('the transporters are the contacts with TRANSPORTER, by name', async () => {
	await create({ phone: '311 908 5512', full_name: 'Wilson Muñoz', services: ['TRANSPORTER'] });
	await create({
		phone: '604 444 1290',
		full_name: 'Transportes La 80',
		services: ['TRANSPORTER', 'DECORATOR']
	});
	await create({ phone: '312 555 7788', full_name: 'Paula Andrea Ríos', services: ['DECORATOR'] });
	await create(luzMarina);
	expect((await listTransporters(db, sales)).map(({ fullName }) => fullName)).toEqual([
		'Transportes La 80',
		'Wilson Muñoz'
	]);
});
