import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import { actorWith, createFixture, MANAGER, SALES } from '../db/fixture';
import { getEmployee } from './employees';
import {
	capitalizeName,
	contactAttributesSchema,
	createContact,
	createLabel,
	deleteLabel,
	findWhatsappOwner,
	generateDocumentId,
	getContact,
	isBannedClient,
	listContacts,
	listLabelRows,
	listTransporters,
	newClientStatements,
	renameLabel,
	searchClients,
	updateContact
} from './contacts';

let fixture: ReturnType<typeof createFixture>;
let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	fixture = createFixture();
	({ db, database } = fixture);
});

const luzMarina = { phone: '310 442 8890', full_name: 'Luz Marina Restrepo' };

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

test('labels: a key not in CONTACTS_LABELS or a repeated one is refused on its field', async () => {
	for (const labels of [['PHOTOGRAPHER'], ['CHEF', 'CHEF']]) {
		expect(
			await createContact(db, { ...luzMarina, document_id: '1036452118', labels }, MANAGER)
		).toMatchObject({ ok: false, errors: { labels: expect.any(String) } });
	}
	expect(database.prepare('select count(*) as count from contacts').get()).toEqual({ count: 0 });
});

test('a contact saves its phone normalized and its optional fields in attributes', async () => {
	const id = await fixture.contact({
		...luzMarina,
		document_id: '1.036.452.118',
		email: 'luzmarina.r@gmail.com',
		address_1: 'Cra 43A #18-95',
		address_2: '',
		labels: ['DECORATOR', 'BANNED']
	});
	expect(await getContact(db, id, SALES)).toEqual({
		id,
		phone: '573104428890',
		whatsapp: null,
		fullName: 'Luz Marina Restrepo',
		documentId: '1036452118',
		labels: ['BANNED', 'DECORATOR'],
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
	const result = await createContact(db, { phone: '442 8890', full_name: ' ' }, SALES);
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
	const id = await fixture.contact({ full_name: 'Luz Marina Restrepo', phone: '', ...typed });
	expect(await getContact(db, id, SALES)).toMatchObject(saved);
});

test('a username that is not valid comes back on its field', async () => {
	const result = await createContact(db, { ...luzMarina, whatsapp: 'mayc.com' }, SALES);
	expect(result).toMatchObject({
		ok: false,
		errors: { whatsapp: 'Escriba el usuario como aparece en WhatsApp, por ejemplo @mayc47.' }
	});
});

test('a username another contact has, in any case, is named for the warning and still saves', async () => {
	const luz = await fixture.contact({ ...luzMarina, whatsapp: 'LuzMarinaR' });
	const input = { whatsapp: '@luzmarinar', exceptId: null };
	expect(await findWhatsappOwner(db, input, SALES)).toBe('Luz Marina Restrepo');
	const other = await fixture.contact({ full_name: 'Luz Marina Arango', whatsapp: 'luzmarinar' });
	expect(await getContact(db, other, SALES)).toMatchObject({ whatsapp: 'luzmarinar' });
	// The contact's own username doesn't count; an invalid or missing one names no one.
	expect(await findWhatsappOwner(db, { whatsapp: 'LuzMarinaR', exceptId: other }, SALES)).toBe(
		'Luz Marina Restrepo'
	);
	expect(await findWhatsappOwner(db, { whatsapp: 'nadie', exceptId: luz }, SALES)).toBeNull();
	expect(await findWhatsappOwner(db, { whatsapp: 'may..c', exceptId: null }, SALES)).toBeNull();
	expect(await findWhatsappOwner(db, { whatsapp: null, exceptId: null }, SALES)).toBeNull();
	const driver = actorWith('DRIVER');
	expect(await rejection(findWhatsappOwner(db, input, driver))).toBe(403);
});

test("changing a contact's username logs it with before and after", async () => {
	const id = await fixture.contact({
		...luzMarina,
		document_id: '1036452118',
		whatsapp: 'LuzMarinaR'
	});
	const edit = { ...luzMarina, id, document_id: '1036452118', whatsapp: '@LuzMarina_R' };
	expect(await updateContact(db, edit, SALES)).toEqual({ ok: true, id });
	const edited = database.prepare("select before, after from events where action = 'EDITED'").get();
	expect(JSON.parse(String(edited?.before))).toEqual({ whatsapp: 'LuzMarinaR' });
	expect(JSON.parse(String(edited?.after))).toEqual({ whatsapp: 'LuzMarina_R' });
});

test('the email is validated only when it has a value', async () => {
	const typed = { ...luzMarina, document_id: '1036452118' };
	const result = await createContact(db, { ...typed, email: 'luzmarina' }, SALES);
	expect(result).toMatchObject({ ok: false, errors: { email: expect.any(String) } });
	expect((await createContact(db, { ...typed, email: '' }, SALES)).ok).toBe(true);
});

test("a company's branches share its switchboard: two contacts can have one phone", async () => {
	await fixture.contact({ ...luzMarina, document_id: '900.456.123-4' });
	await fixture.contact({
		phone: '+57 3104428890',
		full_name: 'Sucursal Centro',
		document_id: '9004561235'
	});
	expect((await listContacts(db, { search: '442 8890' }, SALES)).contacts).toHaveLength(2);
});

test("the list carries each contact's phone and username, either one null", async () => {
	await fixture.contact({ full_name: 'Mayra Castaño', phone: '', whatsapp: '@MayC47' });
	await fixture.contact(luzMarina);
	const { contacts } = await listContacts(db, {}, SALES);
	expect(contacts.map(({ phone, whatsapp }) => ({ phone, whatsapp }))).toEqual([
		{ phone: '573104428890', whatsapp: null },
		{ phone: null, whatsapp: 'MayC47' }
	]);
});

test('the automatic document is @ and 8 symbols of Crockford base32', () => {
	expect(generateDocumentId()).toMatch(/^@[0-9A-HJKMNP-TV-Z]{8}$/);
	expect(generateDocumentId()).not.toBe(generateDocumentId());
});

test('one document per contact, never typed as an automatic one', async () => {
	await fixture.contact({ ...luzMarina, document_id: '1.036.452.118' });
	const result = await createContact(
		db,
		{ phone: '300 771 2043', full_name: 'Jorge Iván Betancur', document_id: '1036452118' },
		MANAGER
	);
	expect(result).toMatchObject({
		ok: false,
		errors: { document_id: 'Esa cédula o NIT ya es de Luz Marina Restrepo' }
	});
	expect(
		await createContact(db, { ...luzMarina, document_id: '@ABCDEFGH' }, MANAGER)
	).toMatchObject({ ok: false, errors: { document_id: expect.stringContaining('automáticos') } });
});

const DOCUMENT_REQUIRED = { ok: false, errors: { document_id: 'Escribe la cédula o NIT' } };

test('Contactos never creates a contact without a real document', async () => {
	for (const documentId of [undefined, '', ' . - ']) {
		const typed = { ...luzMarina, document_id: documentId };
		expect(await createContact(db, typed, MANAGER)).toMatchObject(DOCUMENT_REQUIRED);
	}
	expect(database.prepare('select count(*) as count from contacts').get()).toEqual({ count: 0 });
});

/** A contact as «Cliente nuevo» on the order form leaves it: an automatic document. */
async function newClient(): Promise<{ id: number; automatic: string }> {
	const automatic = generateDocumentId();
	const client = {
		phone: '573104428890',
		whatsapp: null,
		fullName: 'Luz Marina Restrepo',
		documentId: automatic
	};
	const [inserted] = await db.batch(newClientStatements(db, SALES, client));
	return { id: inserted.meta.last_row_id, automatic };
}

test('Contactos never saves an edit that leaves the document empty or still automatic', async () => {
	const { id, automatic } = await newClient();
	expect(await getContact(db, id, SALES)).toMatchObject({ hasAutoDocument: true });
	for (const documentId of ['', automatic]) {
		for (const actor of [SALES, MANAGER]) {
			const typed = { ...luzMarina, document_id: documentId, id };
			expect(await updateContact(db, typed, actor)).toMatchObject(
				'' === documentId
					? DOCUMENT_REQUIRED
					: { ok: false, errors: { document_id: expect.stringContaining('automático') } }
			);
		}
	}
	const real = await fixture.contact({ ...luzMarina, document_id: '1036452118' });
	expect(
		await updateContact(db, { ...luzMarina, document_id: '', id: real }, MANAGER)
	).toMatchObject(DOCUMENT_REQUIRED);
	expect((await getContact(db, real, MANAGER))?.documentId).toBe('1036452118');
});

test('Sales types the real document over an automatic one, and on a new contact', async () => {
	const { id } = await newClient();
	const typed = { ...luzMarina, document_id: '1.036.452.118', id };
	expect(await updateContact(db, typed, SALES)).toEqual({ ok: true, id });
	expect(await getContact(db, id, SALES)).toMatchObject({
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
	const created = await createContact(db, jorge, SALES);
	expect(created).toMatchObject({ ok: true });
});

test('once real, only Manager and Admin change the document: Sales gets a 403', async () => {
	const id = await fixture.contact({ ...luzMarina, document_id: '1036452118' });
	const kept = { ...luzMarina, document_id: '1.036.452.118', bank_account: 'Nequi 310 442 8890' };
	expect(await updateContact(db, { ...kept, id }, SALES)).toEqual({ ok: true, id });
	expect(await rejection(updateContact(db, { ...kept, document_id: '71384902', id }, SALES))).toBe(
		403
	);
	for (const [actor, documentId] of [
		[MANAGER, '71384902'],
		[actorWith('ADMIN'), '900.312.554-1']
	] as const) {
		const changed = { ...kept, document_id: documentId, id };
		expect(await updateContact(db, changed, actor)).toEqual({ ok: true, id });
	}
	expect((await getContact(db, id, MANAGER))?.documentId).toBe('9003125541');
});

test('search by name or by three digits of the phone, with the etiqueta filter, a page at a time', async () => {
	await fixture.contact({ phone: '300 771 2043', full_name: 'Jorge Iván Betancur' });
	await fixture.contact({ ...luzMarina, labels: ['DECORATOR'] });
	await fixture.contact({
		phone: '311 908 5512',
		full_name: 'Wilson Muñoz',
		labels: ['TRANSPORTER']
	});
	const names = async (input: Record<string, unknown>) =>
		(await listContacts(db, input, SALES)).contacts.map((contact) => contact.fullName);

	expect(await names({})).toEqual(['Jorge Iván Betancur', 'Luz Marina Restrepo', 'Wilson Muñoz']);
	expect(await names({ search: 'marina' })).toEqual(['Luz Marina Restrepo']);
	expect(await names({ search: 'réstrepo  LUZ' })).toEqual(['Luz Marina Restrepo']);
	expect(await names({ search: '442 8890' })).toEqual(['Luz Marina Restrepo']);
	expect(await names({ search: '44' })).toHaveLength(3);
	expect(await names({ label: 'TRANSPORTER' })).toEqual(['Wilson Muñoz']);
	expect(await names({ label: 'TRANSPORTER', search: 'luz' })).toEqual([]);
	expect(await names({ label: 'BOGUS', page: 'x' })).toHaveLength(3);
	// The search never matches an etiqueta's name.
	expect(await names({ search: 'Decorador' })).toEqual([]);

	for (let i = 0; i < 19; i++) {
		await fixture.contact({ phone: `320 000 00${10 + i}`, full_name: `Zoila ${i}` });
	}
	const first = await listContacts(db, {}, SALES);
	expect(first).toMatchObject({ total: 22, pageCount: 2, filters: { page: 1 } });
	expect(first.contacts).toHaveLength(20);
	const second = await listContacts(db, { page: '2' }, SALES);
	expect(second.contacts.map((contact) => contact.fullName)).toEqual(['Zoila 8', 'Zoila 9']);
	// Past the last page, a typed URL gets the last one.
	expect((await listContacts(db, { page: '1000' }, SALES)).filters.page).toBe(2);
});

const withAccount = {
	...luzMarina,
	document_id: '1036452118',
	bank_account: 'Nequi 310 442 8890',
	labels: ['DECORATOR']
};

test('Sales is rejected changing etiquetas, a set bank account or the document', async () => {
	const id = await fixture.contact(withAccount);
	for (const change of [
		{ labels: [] },
		{ labels: ['DECORATOR', 'BANNED'] },
		{ bank_account: 'Bancolombia 123' },
		{ bank_account: '' },
		{ document_id: '71384902' }
	]) {
		expect(await rejection(updateContact(db, { ...withAccount, ...change, id }, SALES))).toBe(403);
	}
	expect(await rejection(createContact(db, { ...withAccount, phone: '3007712043' }, SALES))).toBe(
		403
	);
});

test("an employee's document is Manager's and Admin's, and never left empty", async () => {
	const ana = { phone: '310 442 8890', full_name: 'Ana Pérez', document_id: '1036452118' };
	const { employeeId } = await fixture.employee({ roles: ['WAREHOUSE'], ...ana });
	const id = (await getEmployee(db, Number(employeeId), MANAGER))!.contactId;
	expect(await getContact(db, id, SALES)).toMatchObject({ isEmployee: true });
	expect((await listContacts(db, {}, SALES)).contacts).toMatchObject([{ isEmployee: true }]);
	await fixture.contact({ phone: '300 771 2043', full_name: 'Jorge Iván Betancur' });
	expect((await listContacts(db, { label: 'EMPLOYEE' }, SALES)).contacts).toMatchObject([
		{ fullName: 'Ana Pérez' }
	]);
	expect(await rejection(updateContact(db, { ...ana, document_id: '1', id }, SALES))).toBe(403);
	expect(await updateContact(db, { ...ana, full_name: 'Ana P.', id }, SALES)).toEqual({
		ok: true,
		id
	});
	expect(await updateContact(db, { ...ana, document_id: '', id }, MANAGER)).toMatchObject(
		DOCUMENT_REQUIRED
	);
});

test('an edit logs only the changed attributes key, old and new', async () => {
	const id = await fixture.contact({ ...withAccount, notes: 'Llamar tarde' });
	await updateContact(
		db,
		{ ...withAccount, notes: 'Llamar tarde', bank_account: 'Daviplata 1', id },
		MANAGER
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

test("an edit logs the etiquetas' keys, old and new, and the order picked changes nothing", async () => {
	const id = await fixture.contact(withAccount);
	await updateContact(db, { ...withAccount, labels: ['DECORATOR', 'BANNED'], id }, MANAGER);
	await updateContact(db, { ...withAccount, labels: ['BANNED', 'DECORATOR'], id }, MANAGER);
	const edit = database.prepare("select before, after from events where action = 'EDITED'").all();
	expect(
		edit.map(({ before, after }) => [JSON.parse(String(before)), JSON.parse(String(after))])
	).toEqual([[{ labels: '["DECORATOR"]' }, { labels: '["BANNED","DECORATOR"]' }]]);
});

test('an etiqueta not in CONTACTS_LABELS, or an old service link, reads as every contact', async () => {
	await fixture.contact({ ...luzMarina, labels: ['DECORATOR'] });
	await fixture.contact({ phone: '311 908 5512', full_name: 'Wilson Muñoz' });
	for (const input of [{ label: 'NO_EXISTE' }, { service: 'DECORATOR' }]) {
		const page = await listContacts(db, input, SALES);
		expect(page.contacts).toHaveLength(2);
		expect(page.filters.label).toBeUndefined();
	}
	const decorators = await listContacts(db, { label: 'DECORATOR' }, SALES);
	expect(decorators).toMatchObject({
		contacts: [{ fullName: 'Luz Marina Restrepo', labels: ['DECORATOR'] }],
		filters: { label: 'DECORATOR' }
	});
	expect(decorators.labels.map(({ name }) => name)).toContain('Vetado');
});

test('an edit that changes nothing writes nothing', async () => {
	const id = await fixture.contact(withAccount);
	await updateContact(db, { ...withAccount, phone: '+57 310 442 8890', id }, SALES);
	expect(database.prepare('select count(*) as count from events').get()).toEqual({ count: 1 });
});

test('letters also find the username, without the @ and ignoring case; digits only the phone', async () => {
	await fixture.contact({ full_name: 'Luz Marina', whatsapp: 'LuzMarinaR' });
	await fixture.contact({
		phone: '310 442 8890',
		full_name: 'Jorge Betancur',
		whatsapp: 'jorge442'
	});
	const names = async (search: string) =>
		(await listContacts(db, { search }, SALES)).contacts.map((contact) => contact.fullName);
	expect(await names('luzma')).toEqual(['Luz Marina']);
	expect(await names('@LUZMA')).toEqual(['Luz Marina']);
	expect(await names('@jorge')).toEqual(['Jorge Betancur']);
	expect(await names('442')).toEqual(['Jorge Betancur']);
	expect(await names('luz_')).toEqual([]);
	expect(await names('luz marina')).toEqual(['Luz Marina']);
});

test('Warehouse and Driver have no access to contacts', async () => {
	for (const role of ['WAREHOUSE', 'DRIVER'] as const) {
		expect(await rejection(listContacts(db, {}, actorWith(role)))).toBe(403);
		expect(await rejection(createContact(db, luzMarina, actorWith(role)))).toBe(403);
	}
});

test('the order form finds clients by name, address or phone, by name, with their address', async () => {
	const company = { ...luzMarina, full_name: 'Eventos Restrepo S.A.S.', document_id: '900312554' };
	const companyId = await fixture.contact(company);
	const luzMarinaId = await fixture.contact({
		...luzMarina,
		address_1: 'Cra 43A #18-95, El Poblado',
		address_2: 'Piso 2'
	});
	await fixture.contact({ phone: '311 222 3344', full_name: 'Otro' });
	const ids = async (typed: string) =>
		(await searchClients(db, typed, SALES)).map((client) => client.id);
	expect(await searchClients(db, '+57 310 442 8890', SALES)).toEqual([
		{
			id: companyId,
			fullName: 'Eventos Restrepo S.A.S.',
			phone: '573104428890',
			whatsapp: null,
			address1: null,
			address2: null,
			isBanned: false
		},
		{
			id: luzMarinaId,
			fullName: 'Luz Marina Restrepo',
			phone: '573104428890',
			whatsapp: null,
			address1: 'Cra 43A #18-95, El Poblado',
			address2: 'Piso 2',
			isBanned: false
		}
	]);
	expect(await ids('restrepo')).toEqual([companyId, luzMarinaId]);
	expect(await ids('poblado MARINA')).toEqual([luzMarinaId]);
	expect(await ids('piso 2')).toEqual([luzMarinaId]);
	expect(await ids('44')).toEqual([]);
	const username = await fixture.contact({ full_name: 'Mayra', whatsapp: 'LuzMarinaR' });
	expect(await ids('luzma')).toEqual([username]);
	expect(await ids('@LUZMA')).toEqual([username]);
	expect(await rejection(searchClients(db, 'luz', actorWith('WAREHOUSE')))).toBe(403);
});

test('a client carrying Vetado is found marked, for the forms’ warning under «Cliente»', async () => {
	const id = await fixture.contact({ ...luzMarina, labels: ['BANNED'] });
	const other = await fixture.contact({ phone: '311 222 3344', full_name: 'Luz Elena' });
	const found = await searchClients(db, 'luz', SALES);
	expect(found.map(({ id, isBanned }) => ({ id, isBanned }))).toEqual([
		{ id: other, isBanned: false },
		{ id, isBanned: true }
	]);
	expect(await isBannedClient(db, id, SALES)).toBe(true);
	expect(await isBannedClient(db, other, SALES)).toBe(false);
});

test.each([
	['luz marina restrepo', 'Luz Marina Restrepo'],
	['JUAN PEREZ', 'Juan Perez'],
	['INVERSIONES ABC S.A.S.', 'Inversiones ABC S.A.S.'],
	['ABC eventos', 'ABC Eventos'],
	['McDonald', 'McDonald'],
	['maría de la cruz', 'María de la Cruz'],
	['de la torre', 'De la Torre'],
	["ana-maría o'neill", "Ana-María O'Neill"]
])('a new contact typed «%s» is saved «%s»', async (typed, saved) => {
	expect(capitalizeName(typed)).toBe(saved);
	const id = await fixture.contact({ full_name: typed });
	expect((await getContact(db, id, SALES))?.fullName).toBe(saved);
});

test('an edit saves the name exactly as typed', async () => {
	const id = await fixture.contact({ ...luzMarina, document_id: '1036452118' });
	const edit = { ...luzMarina, full_name: 'luz marina restrepo', document_id: '1036452118', id };
	expect(await updateContact(db, edit, SALES)).toEqual({ ok: true, id });
	expect((await getContact(db, id, SALES))?.fullName).toBe('luz marina restrepo');
});

test('the transporters are the contacts with TRANSPORTER, by name, with phone and username', async () => {
	await fixture.contact({
		phone: '',
		whatsapp: '@WilsonMudanzas',
		full_name: 'Wilson Muñoz',
		labels: ['TRANSPORTER']
	});
	await fixture.contact({
		phone: '604 444 1290',
		full_name: 'Transportes La 80',
		labels: ['TRANSPORTER', 'DECORATOR']
	});
	await fixture.contact({
		phone: '312 555 7788',
		full_name: 'Paula Andrea Ríos',
		labels: ['DECORATOR']
	});
	await fixture.contact(luzMarina);
	expect((await listTransporters(db, SALES)).map(({ fullName }) => fullName)).toEqual([
		'Transportes La 80',
		'Wilson Muñoz'
	]);
	expect((await listTransporters(db, SALES))[1]).toMatchObject({
		fullName: 'Wilson Muñoz',
		phone: null,
		whatsapp: 'WilsonMudanzas'
	});
});

// Configuración › Etiquetas.

const labelNames = async () => (await listLabelRows(db, MANAGER)).map(({ name }) => name);

function settingsEvents() {
	return database
		.prepare("select before, after from events where entity_type = 'SETTINGS'")
		.all()
		.map(({ before, after }) => [JSON.parse(String(before)), JSON.parse(String(after))]);
}

test('the editor lists every etiqueta A–Z with how many contacts carry it', async () => {
	await fixture.contact({ ...luzMarina, labels: ['DECORATOR', 'CHEF'] });
	await fixture.contact({ phone: '311 908 5512', full_name: 'Wilson Muñoz', labels: ['CHEF'] });
	const rows = await listLabelRows(db, MANAGER);
	expect(rows.map(({ name }) => name)).toEqual([
		'Barista',
		'Bartender',
		'Chef',
		'Decorador',
		'Mesero',
		'Transportador',
		'Vetado',
		'Wedding planner'
	]);
	expect(rows.find(({ key }) => 'CHEF' === key)).toMatchObject({
		contactCount: 2,
		isBuiltIn: false
	});
	expect(rows.filter(({ isBuiltIn }) => isBuiltIn).map(({ key }) => key)).toEqual([
		'TRANSPORTER',
		'BANNED'
	]);
});

test('«Nueva etiqueta» adds one sorted by name; a blank or repeated name is refused', async () => {
	expect(await createLabel(db, { name: '  Proveedor de carpas ' }, MANAGER)).toEqual({ ok: true });
	expect(await labelNames()).toContain('Proveedor de carpas');
	expect((await listLabelRows(db, MANAGER)).map(({ key }) => key)).toContain('PROVEEDOR_DE_CARPAS');
	expect(await createLabel(db, { name: '   ' }, MANAGER)).toEqual({
		ok: false,
		message: 'Escribe el nombre',
		errors: {}
	});
	expect(await createLabel(db, { name: 'vetado' }, MANAGER)).toEqual({
		ok: false,
		message: 'Ya existe una etiqueta con ese nombre',
		errors: {}
	});
	expect(settingsEvents()).toEqual([
		[{ value: '[]' }, { value: '[{"key":"PROVEEDOR_DE_CARPAS","name":"Proveedor de carpas"}]' }]
	]);
});

test('renaming changes only the name: the contacts keep the key and read the new name', async () => {
	const id = await fixture.contact({ ...luzMarina, labels: ['WEDDING_PLANNER'] });
	const renamed = { key: 'WEDDING_PLANNER', name: 'Organizador de bodas' };
	expect(await renameLabel(db, renamed, MANAGER)).toEqual({ ok: true });
	expect((await getContact(db, id, MANAGER))?.labels).toEqual(['WEDDING_PLANNER']);
	expect(
		database
			.prepare(
				"select count(*) as count from events where entity_type = 'CONTACT' and action = 'EDITED'"
			)
			.get()
	).toEqual({ count: 0 });
	expect(await labelNames()).toContain('Organizador de bodas');
	expect(await renameLabel(db, { key: 'BANNED', name: 'Bloqueado' }, MANAGER)).toEqual({
		ok: true
	});
	expect(await renameLabel(db, { key: 'CHEF', name: 'bloqueado' }, MANAGER)).toMatchObject({
		ok: false
	});
	expect(settingsEvents()[0]).toEqual([
		{ value: '[{"key":"WEDDING_PLANNER","name":"Wedding planner"}]' },
		{ value: JSON.stringify([renamed]) }
	]);
});

test('deleting strips the key from every contact that carries it, in the same batch', async () => {
	const carriers = [];
	for (const name of ['Ana', 'Beto', 'Carla', 'Dora']) {
		carriers.push(await fixture.contact({ full_name: name, labels: ['BARISTA', 'CHEF'] }));
	}
	const other = await fixture.contact({ ...luzMarina, labels: ['CHEF'] });
	expect(await deleteLabel(db, { key: 'BARISTA' }, MANAGER)).toEqual({ ok: true });
	expect(await labelNames()).not.toContain('Barista');
	for (const id of [...carriers, other]) {
		expect((await getContact(db, id, MANAGER))?.labels).toEqual(['CHEF']);
	}
	const contactEdits = database
		.prepare(
			"select entity_id, before, after from events where entity_type = 'CONTACT' and action = 'EDITED'"
		)
		.all();
	expect(contactEdits).toEqual(
		carriers.map((id) => ({
			entity_id: id,
			before: JSON.stringify({ labels: '["BARISTA","CHEF"]' }),
			after: JSON.stringify({ labels: '["CHEF"]' })
		}))
	);
	expect(settingsEvents()).toEqual([
		[{ value: '[{"key":"BARISTA","name":"Barista"}]' }, { value: '[]' }]
	]);
});

test('an etiqueta no contact carries is deleted too; Transportador and Vetado never', async () => {
	expect(await deleteLabel(db, { key: 'BARTENDER' }, MANAGER)).toEqual({ ok: true });
	for (const key of ['TRANSPORTER', 'BANNED']) {
		expect(await deleteLabel(db, { key }, MANAGER)).toMatchObject({ ok: false });
	}
	expect(await labelNames()).toEqual(expect.arrayContaining(['Transportador', 'Vetado']));
});

test('only ADMIN and MANAGER read or change the etiquetas', async () => {
	const admin = actorWith('ADMIN');
	expect(await createLabel(db, { name: 'Fotógrafo' }, admin)).toEqual({ ok: true });
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] as const) {
		const actor = actorWith(role);
		expect(await rejection(listLabelRows(db, actor))).toBe(403);
		expect(await rejection(createLabel(db, { name: 'Florista' }, actor))).toBe(403);
		expect(await rejection(renameLabel(db, { key: 'CHEF', name: 'Cocinero' }, actor))).toBe(403);
		expect(await rejection(deleteLabel(db, { key: 'CHEF' }, actor))).toBe(403);
	}
});
