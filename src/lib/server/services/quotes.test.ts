import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createFixture, DRIVER, MANAGER, SALES, WAREHOUSE } from '../db/fixture';
import { addDays } from '$lib/datetime';
import { getQuoteState, QUOTE_STATE_SQL } from '$lib/quotes';
import { getContact, updateContact } from './contacts';
import { submitAndApproveCount } from './inventory';
import {
	cancelOrder,
	getOrder,
	getOrderDetail,
	offeredPaymentConcepts,
	type OrderStatus
} from './orders';
import { getProduct, updateProduct } from './products';
import {
	convertQuote,
	createQuote,
	getQuoteConversion,
	getQuoteAvailability,
	getQuoteFormOptions,
	getQuotePrintout,
	getQuote,
	getQuoteChange,
	getQuoteDetail,
	getOrderRequote,
	getQuoteDuplicate,
	getQuotePublicToken,
	getQuoteTimeline,
	getSourceQuoteId,
	listQuotes,
	QUOTES_PAGE_SIZE,
	quoteAttributesSchema,
	updateQuote,
	type QuoteDraft
} from './quotes';
import { getSystemSettings, updateSystemSettings } from './settings';

let db: D1Database;
let database: DatabaseSync;
let fixture: ReturnType<typeof createFixture>;

// The clock on Sunday 1 November 2026, 10:00 a.m. in Bogotá.
const NOVEMBER_1 = new Date('2026-11-01T15:00:00Z');

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOVEMBER_1);
	fixture = createFixture();
	({ db, database } = fixture);
	await fixture.contact({ full_name: 'Postobón S.A.', phone: '576045765100' });
	await fixture.contact({ full_name: 'Luz Marina Restrepo', phone: '573104428890' });
	await fixture.product({
		name: 'Silla Tiffany dorada',
		rental_price: '2500',
		total_quantity: '500'
	});
	await fixture.product({
		name: 'Mesa redonda 10 puestos',
		rental_price: '12000',
		total_quantity: '500'
	});
	await fixture.product({
		name: 'Copa para vino tinto',
		rental_price: '900',
		total_quantity: '500'
	});
	await fixture.product({
		name: 'Silla Rimax',
		rental_price: '1500',
		total_quantity: '500',
		active: 'off'
	});
});

afterEach(() => {
	vi.useRealTimers();
});

const POSTOBON = 1;
const LUZ_MARINA = 2;
const RIMAX = 4;

// Productos › Editar as the manager saves it: the product as it is, with `changes` typed over it.
async function editProduct(id: number, changes: Record<string, string>) {
	const current = await getProduct(db, id, MANAGER);
	if (null === current) {
		throw new Error(`Product ${id} not found`);
	}
	const form = {
		id,
		name: current.name,
		category: current.category,
		rental_price: String(current.rentalPrice),
		active: current.isActive ? 'on' : 'off',
		...changes
	};
	const result = await updateProduct(db, form, MANAGER);
	if (!result.ok) {
		throw new Error(result.message);
	}
}

// Contactos › Editar as `actor` saves it: the contact as it is, with `changes` typed over it.
async function editContact(id: number, changes: Record<string, unknown>, actor = MANAGER) {
	const current = await getContact(db, id, MANAGER);
	if (null === current) {
		throw new Error(`Contact ${id} not found`);
	}
	const typed = {
		phone: current.phone,
		whatsapp: current.whatsapp,
		full_name: current.fullName,
		document_id: current.documentId,
		email: current.email,
		address_1: current.address1,
		address_2: current.address2,
		bank_account: current.bankAccount,
		notes: current.notes
	};
	// An empty field posts as empty text, never as null.
	const posted = Object.entries(typed).map(([key, value]) => [key, value ?? '']);
	const form = { id, ...Object.fromEntries(posted), labels: current.labels, ...changes };
	const result = await updateContact(db, form, actor);
	if (!result.ok) {
		throw new Error(JSON.stringify(result));
	}
}

// #1043's lines and terms, quoted.
const quote1043 = {
	client_id: LUZ_MARINA,
	client_name: 'Luz Marina Restrepo',
	event_date: '2026-12-12',
	valid_until: '2026-12-01',
	rental_days: 2,
	quote_items: [
		{ product_id: 1, qty: 120, unit_price: 2500 },
		{ product_id: 2, qty: 12, unit_price: 12000 },
		{ product_id: 3, qty: 120, unit_price: 900 }
	],
	discount: 104000,
	transport_cost: 180000,
	transported_by: 'COMPANY',
	address_1: 'Cra 43A #18-95, El Poblado',
	address_2: 'Salón Social Torre Verde, piso 2',
	notes: 'Precios incluyen montaje y desmontaje'
};

async function read(id: number) {
	const quote = await getQuote(db, id, SALES);
	if (null === quote) {
		throw new Error(`Quote ${id} not found`);
	}
	return quote;
}

function quoteEvents() {
	return database
		.prepare("select action, before, after from events where entity_type = 'QUOTE' order by id")
		.all()
		.map((event) => ({
			action: event.action,
			before: null === event.before ? null : JSON.parse(String(event.before)),
			after: JSON.parse(String(event.after))
		}));
}

function errorsOf(result: Awaited<ReturnType<typeof createQuote>>) {
	return result.ok ? {} : result.errors;
}

test('attributes take the event address and the notes, every key optional, and nothing else', () => {
	const accepts = (attributes: unknown) => quoteAttributesSchema.safeParse(attributes).success;
	expect(accepts({})).toBe(true);
	expect(accepts({ notes: 'Precios incluyen montaje y desmontaje' })).toBe(true);
	expect(accepts({ address_1: 'Hacienda Fizebad, km 38 vía Las Palmas' })).toBe(true);
	expect(
		accepts({ address_1: 'Hacienda Fizebad, km 38 vía Las Palmas', address_2: 'Salón principal' })
	).toBe(true);
	expect(accepts({ address_2: 'Salón principal' })).toBe(false);
	expect(accepts({ notes: 'x', status: 'REJECTED' })).toBe(false);
	expect(accepts({ notes: '' })).toBe(false);
});

test("#1043's lines total $1.180.000, worked out by the service, ignoring any total sent", async () => {
	const id = await fixture.quote({ ...quote1043, items_total: 1, quote_total: 1 });
	expect(id).toBe(1);
	expect(await read(id)).toMatchObject({
		state: 'VALID',
		orderId: null,
		client: { name: 'Luz Marina Restrepo', phone: '573104428890' },
		itemsTotal: 1104000,
		discount: 104000,
		transportCost: 180000,
		quoteTotal: 1180000,
		address1: 'Cra 43A #18-95, El Poblado',
		notes: 'Precios incluyen montaje y desmontaje'
	});
	const items = (await read(id)).items;
	expect(items.map((item) => [item.name, item.list_price, item.line_total])).toEqual([
		['Silla Tiffany dorada', 2500, 600000],
		['Mesa redonda 10 puestos', 12000, 288000],
		['Copa para vino tinto', 900, 216000]
	]);
});

test('transport left empty is «por acordar», NULL and out of the total; 0 is a real $0', async () => {
	const open = await read(await fixture.quote({ ...quote1043, transport_cost: null }));
	expect([open.transportCost, open.quoteTotal]).toEqual([null, 1104000 - 104000]);
	const omitted = { ...quote1043 } as Partial<typeof quote1043>;
	delete omitted.transport_cost;
	expect((await read(await fixture.quote(omitted))).transportCost).toBeNull();
	const free = await read(await fixture.quote({ ...quote1043, transport_cost: 0 }));
	expect([free.transportCost, free.quoteTotal]).toEqual([0, 1000000]);
	const stored = database.prepare('select transport_cost from quotes order by id').all();
	expect(stored.map((row) => row.transport_cost)).toEqual([null, null, 0]);
});

test('lines follow the order rules: none, a repeated product or an inactive one is refused', async () => {
	const line = { product_id: 1, qty: 10, unit_price: 2500 };
	const refused = [
		{ quote_items: [] },
		{ quote_items: [line, { ...line, qty: 5 }] },
		{ quote_items: [line, { product_id: RIMAX, qty: 10, unit_price: 1500 }] },
		{ quote_items: [{ ...line, qty: 0 }] },
		{ quote_items: [{ ...line, unit_price: 2500.5 }] }
	];
	const errors = await Promise.all(
		refused.map(async (change) =>
			errorsOf(await createQuote(db, { ...quote1043, discount: 0, ...change }, SALES))
		)
	);
	expect(errors).toEqual([
		{ quote_items: 'Agrega al menos un producto' },
		{ quote_items: 'Ese producto ya está en otra línea: cambia su cantidad' },
		{ 'quote_items.1.product_id': 'Ese producto no existe o está inactivo' },
		{ 'quote_items.0.qty': 'La cantidad es al menos 1' },
		{ 'quote_items.0.unit_price': expect.any(String) }
	]);
	expect(database.prepare('select count(*) as count from quotes').get()).toEqual({ count: 0 });
});

test('a discount above the subtotal, or a negative discount or transport, fails on its field', async () => {
	const refused = [{ discount: 1104001 }, { discount: -1 }, { transport_cost: -1 }];
	const errors = await Promise.all(
		refused.map(async (change) =>
			errorsOf(await createQuote(db, { ...quote1043, ...change }, SALES))
		)
	);
	expect(errors).toEqual([
		{ discount: 'El descuento no puede ser mayor que el subtotal' },
		{ discount: 'No puede ser negativo' },
		{ transport_cost: 'No puede ser negativo' }
	]);
	expect((await read(await fixture.quote({ ...quote1043, discount: 1104000 }))).quoteTotal).toBe(
		180000
	);
});

test('rental days are a whole number of at least 1', async () => {
	for (const rentalDays of [0, 1.5]) {
		const input = { ...quote1043, rental_days: rentalDays, discount: 0 };
		const result = await createQuote(db, input, SALES);
		expect(Object.keys(errorsOf(result))).toEqual(['rental_days']);
	}
});

test('the event date and «Lugar del evento» are optional; a second line needs the first', async () => {
	const bare = { ...quote1043, event_date: '', address_1: '', address_2: '', notes: '' };
	const quote = await read(await fixture.quote(bare));
	expect([quote.eventDate, quote.address1, quote.address2, quote.notes]).toEqual([
		null,
		null,
		null,
		null
	]);
	expect(database.prepare('select attributes from quotes').get()).toEqual({ attributes: '{}' });
	const result = await createQuote(db, { ...bare, address_2: 'Salón principal' }, SALES);
	expect(errorsOf(result)).toEqual({ address_1: 'Escribe la primera línea de la dirección' });
});

test('with the clock on 1 November 2026 and the key at 30, a new quote is valid until 1 December', async () => {
	expect(await getQuoteFormOptions(db, SALES)).toMatchObject({
		validUntil: '2026-12-01',
		validityDays: 30
	});
	const values = await getSystemSettings(db, ['QUOTES'], MANAGER);
	const fifteen = { ...values, QUOTES_VALIDITY_DAYS: '15' };
	expect(await updateSystemSettings(db, { modules: ['QUOTES'], values: fifteen }, MANAGER)).toEqual(
		{
			ok: true
		}
	);
	expect((await getQuoteFormOptions(db, SALES)).validUntil).toBe('2026-11-16');
});

test('«Válida hasta» is required and never before the creation day, on create and on edit', async () => {
	const missing = { ...quote1043 } as Partial<typeof quote1043>;
	delete missing.valid_until;
	expect(Object.keys(errorsOf(await createQuote(db, missing, SALES)))).toEqual(['valid_until']);
	const tooSoon = await createQuote(db, { ...quote1043, valid_until: '2026-10-31' }, SALES);
	const message = 'No puede ser antes del día en que se hizo la cotización';
	expect(errorsOf(tooSoon)).toEqual({ valid_until: message });
	const id = await fixture.quote({ ...quote1043, valid_until: '2026-11-01' });
	// Ten days later the creation day still saves; the day before it doesn't.
	vi.setSystemTime(new Date('2026-11-11T15:00:00Z'));
	expect((await read(id)).state).toBe('EXPIRED');
	const edit = { ...quote1043, id, valid_until: '2026-10-31' };
	expect(errorsOf(await updateQuote(db, edit, SALES))).toEqual({ valid_until: message });
	expect(
		await updateQuote(db, { ...edit, valid_until: '2026-11-01', rental_days: 1 }, SALES)
	).toEqual({ ok: true, id });
});

test('an expired quote is renewed by editing it: a new «Válida hasta»', async () => {
	const id = await fixture.quote(quote1043);
	vi.setSystemTime(new Date('2026-12-02T15:00:00Z'));
	expect((await read(id)).state).toBe('EXPIRED');
	await updateQuote(db, { ...quote1043, id, valid_until: '2027-01-01' }, SALES);
	expect((await read(id)).state).toBe('VALID');
});

test('«Cliente nuevo» creates its contact, automatic document, in the same batch, linked', async () => {
	const input = {
		...quote1043,
		client_id: null,
		client_name: 'Colegio San José',
		client_phone: '604 444 1500'
	};
	const id = await fixture.quote(input);
	const contact = database
		.prepare("select id, phone, document_id from contacts where full_name = 'Colegio San José'")
		.get();
	expect(contact).toMatchObject({
		phone: '576044441500',
		document_id: expect.stringMatching(/^@/)
	});
	expect((await read(id)).clientId).toBe(contact?.id);
	const created = database
		.prepare("select entity_type, action from events where action = 'CREATED' order by id")
		.all();
	// The fixture's own contacts and products come first.
	expect(created.slice(-2)).toEqual([
		{ entity_type: 'CONTACT', action: 'CREATED' },
		{ entity_type: 'QUOTE', action: 'CREATED' }
	]);
	const refused = await createQuote(db, { ...input, client_phone: '123' }, SALES);
	expect(Object.keys(errorsOf(refused))).toEqual(['client_phone']);
});

test('«Cliente nuevo» capitalizes the name, and the quote freezes the capitalized one', async () => {
	const fresh = { ...quote1043, client_id: null, client_name: 'luz marina restrepo' };
	const id = await fixture.quote({ ...fresh, client_phone: '315 220 7781' });
	const contact = database.prepare("select full_name from contacts where phone = '573152207781'");
	expect(contact.get()?.full_name).toBe('Luz Marina Restrepo');
	expect((await read(id)).client.name).toBe('Luz Marina Restrepo');
});

test("a quote freezes the picked contact's username, not the typed one; «Cliente nuevo» saves the typed one", async () => {
	await editContact(LUZ_MARINA, { whatsapp: 'LuzMarinaR' });
	const picked = await fixture.quote({ ...quote1043, client_whatsapp: '@otro_usuario' });
	expect((await read(picked)).client).toMatchObject({
		phone: '573104428890',
		whatsapp: 'LuzMarinaR'
	});
	const fresh = await fixture.quote({
		...quote1043,
		client_id: null,
		client_name: 'Colegio San José',
		client_phone: '',
		client_whatsapp: '@ColegioSJ'
	});
	expect((await read(fresh)).client).toEqual({
		name: 'Colegio San José',
		phone: null,
		whatsapp: 'ColegioSJ'
	});
	const contact = database
		.prepare("select phone, whatsapp from contacts where full_name = 'Colegio San José'")
		.get();
	expect(contact).toEqual({ phone: null, whatsapp: 'ColegioSJ' });
});

test("the client's name and phone are the quote's snapshot: renaming the contact changes nothing", async () => {
	const id = await fixture.quote({
		...quote1043,
		client_name: 'Luz Marina Restrepo (mamá de la novia)'
	});
	await editContact(LUZ_MARINA, { full_name: 'Luz M. Restrepo', phone: '573000000000' });
	expect((await read(id)).client).toEqual({
		name: 'Luz Marina Restrepo (mamá de la novia)',
		phone: '573104428890',
		whatsapp: null
	});
	const contact = database.prepare(`select full_name from contacts where id = ${LUZ_MARINA}`).get();
	expect(contact).toEqual({ full_name: 'Luz M. Restrepo' });
});

test('creating logs a QUOTE CREATED event; created_by and updated_by are the actor', async () => {
	expect(await createQuote(db, quote1043, SALES)).toEqual({ ok: true, id: 1 });
	expect(quoteEvents()).toEqual([expect.objectContaining({ action: 'CREATED', before: null })]);
	const row = database.prepare('select created_by, updated_by from quotes where id = 1').get();
	expect(row).toEqual({ created_by: 'sales', updated_by: 'sales' });
});

test('an edit logs only the changed fields; a save with no change logs nothing', async () => {
	const id = await fixture.quote(quote1043);
	expect(await updateQuote(db, { ...quote1043, id }, SALES)).toEqual({ ok: true, id });
	expect(quoteEvents()).toHaveLength(1);
	await updateQuote(db, { ...quote1043, id, discount: 0, transport_cost: null }, SALES);
	expect(quoteEvents()[1]).toEqual({
		action: 'EDITED',
		before: { discount: 104000, transport_cost: 180000, quote_total: 1180000 },
		after: { discount: 0, transport_cost: null, quote_total: 1104000 }
	});
});

test('lines already on the quote keep their frozen name and price; an added line takes today’s', async () => {
	const id = await fixture.quote(quote1043);
	await editProduct(1, { name: 'Silla Tiffany', rental_price: '2800' });
	await editProduct(3, { rental_price: '1000' });
	const items = [quote1043.quote_items[0], { product_id: 3, qty: 50, unit_price: 1000 }];
	await updateQuote(db, { ...quote1043, id, quote_items: items }, SALES);
	const lines = (await read(id)).items;
	expect(lines.map((line) => [line.name, line.list_price, line.unit_price])).toEqual([
		['Silla Tiffany dorada', 2500, 2500],
		['Copa para vino tinto', 900, 1000]
	]);
});

test('changing the client changes client_id and its snapshot together', async () => {
	const id = await fixture.quote(quote1043);
	await updateQuote(
		db,
		{ ...quote1043, id, client_id: POSTOBON, client_name: 'Postobón S.A.' },
		SALES
	);
	expect(await read(id)).toMatchObject({
		clientId: POSTOBON,
		client: { name: 'Postobón S.A.', phone: '576045765100' }
	});
	expect(Object.keys(quoteEvents()[1].after).sort()).toEqual(['client_attributes', 'client_id']);
});

test("a converted quote can't be edited, and a quote that doesn't exist neither", async () => {
	const id = await fixture.quote(quote1043);
	await convert(id);
	expect((await read(id)).state).toBe('CONVERTED');
	const result = await updateQuote(db, { ...quote1043, id, discount: 0 }, SALES);
	expect(result).toMatchObject({ ok: false, message: expect.stringContaining('ya se convirtió') });
	expect((await read(id)).discount).toBe(104000);
	expect(await updateQuote(db, { ...quote1043, id: 99 }, SALES)).toMatchObject({ ok: false });
	expect(await getQuote(db, 99, SALES)).toBeNull();
});

test('WAREHOUSE and DRIVER get a 403 creating, editing or reading a quote', async () => {
	const id = await fixture.quote(quote1043);
	const attempts = [WAREHOUSE, DRIVER].flatMap((actor) => [
		createQuote(db, quote1043, actor),
		updateQuote(db, { ...quote1043, id }, actor),
		getQuote(db, id, actor),
		getQuoteFormOptions(db, actor)
	]);
	for (const attempt of attempts) {
		expect(isHttpError(await attempt.catch((caught) => caught), 403)).toBe(true);
	}
	expect(database.prepare('select count(*) as count from quotes').get()).toEqual({ count: 1 });
});

// Today is 1 November: #1 valid through today, #2 expired yesterday, #3 converted. Saved on 31
// October, the last day #2 and #3 were valid, and #3 converted that day; Jorge's `whatsapp`, if any,
// is frozen into #3.
async function createThreeStates(jorgeFields: Record<string, string> = {}) {
	vi.setSystemTime(new Date('2026-10-31T15:00:00Z'));
	const jorgeName = 'Jorge Iván Betancur';
	const jorge = await fixture.contact({
		full_name: jorgeName,
		phone: '573007712043',
		...jorgeFields
	});
	const line = { product_id: 1, qty: 10, unit_price: 2500 };
	const listed = { rental_days: 1, quote_items: [line], discount: 0 };
	const postobon = { client_id: POSTOBON, client_name: 'Postobón S.A.' };
	await fixture.quote({ ...listed, ...postobon, valid_until: '2026-11-01' });
	await fixture.quote({ ...listed, client_id: LUZ_MARINA, valid_until: '2026-10-31' });
	const client = { client_id: jorge, client_name: jorgeName };
	const converted = await fixture.quote({ ...listed, ...client, valid_until: '2026-10-31' });
	await convert(converted, { ...client, ...listed, order_items: [line] });
	vi.setSystemTime(NOVEMBER_1);
}

async function listIds(input: object) {
	return (await listQuotes(db, input, SALES)).quotes.map((quote) => quote.id);
}

test('the state filter: valid by default, expired, converted, all, and a tampered value is the default', async () => {
	await createThreeStates();
	expect(await listIds({})).toEqual([1]);
	expect(await listIds({ state: 'VALID' })).toEqual([1]);
	expect(await listIds({ state: 'EXPIRED' })).toEqual([2]);
	expect(await listIds({ state: 'CONVERTED' })).toEqual([3]);
	expect(await listIds({ state: 'ALL' })).toEqual([3, 2, 1]);
	const tampered = await listQuotes(db, { state: 'REJECTED' }, SALES);
	expect([tampered.filters.state, tampered.quotes.map((quote) => quote.id)]).toEqual([
		'VALID',
		[1]
	]);
});

test("the SQL state is the state function's, for every row, with Bogotá's today", async () => {
	await createThreeStates();
	vi.setSystemTime(new Date('2026-11-01T04:30:00Z')); // 11:30 p.m. on 31 October in Bogotá
	const today = '2026-10-31';
	const rows = database
		.prepare(`select order_id, valid_until, ${QUOTE_STATE_SQL} as state from quotes order by id`)
		.all(today);
	for (const row of rows) {
		const validity = {
			orderId: row.order_id as number | null,
			validUntil: String(row.valid_until)
		};
		expect(row.state).toBe(getQuoteState(validity, today));
	}
	expect(await listIds({ state: 'VALID' })).toEqual([2, 1]);
	expect(await listIds({ state: 'EXPIRED' })).toEqual([]);
});

test("the text filter is the order list's: a name in another word order, or three digits of the phone", async () => {
	await createThreeStates();
	expect(await listIds({ state: 'ALL', text: 'restrepo  LUZ' })).toEqual([2]);
	expect(await listIds({ state: 'ALL', text: '576 5' })).toEqual([1]);
	expect(await listIds({ state: 'ALL', text: 'betancur', page: '1' })).toEqual([3]);
	expect(await listIds({ state: 'VALID', text: 'restrepo' })).toEqual([]);
});

test("letters also find the snapshot's username, without the @ and ignoring case", async () => {
	await createThreeStates({ whatsapp: 'LuzMarinaR' });
	expect(await listIds({ state: 'ALL', text: 'luzma' })).toEqual([3]);
	expect(await listIds({ state: 'ALL', text: '@LUZMA' })).toEqual([3]);
});

test('each row carries what the list shows: the state, the event date or none, and a pending transport', async () => {
	await fixture.quote({ ...quote1043, transport_cost: null, event_date: '' });
	const [quote] = (await listQuotes(db, {}, SALES)).quotes;
	expect(quote).toEqual({
		id: 1,
		clientName: 'Luz Marina Restrepo',
		eventDate: null,
		validUntil: '2026-12-01',
		state: 'VALID',
		quoteTotal: 1000000,
		isTransportPending: true
	});
});

test('newest first, 20 a page; a page past the last shows the last; no quote at all is told apart', async () => {
	const empty = await listQuotes(db, {}, SALES);
	expect([empty.hasQuotes, empty.total, empty.pageCount]).toEqual([false, 0, 1]);
	const line = { product_id: 1, qty: 10, unit_price: 2500 };
	for (let i = 0; i < 23; i += 1) {
		await fixture.quote({ client_id: POSTOBON, valid_until: '2026-12-01', quote_items: [line] });
	}
	const first = await listQuotes(db, {}, SALES);
	expect(first.quotes).toHaveLength(QUOTES_PAGE_SIZE);
	expect([first.quotes[0].id, first.total, first.pageCount, first.hasQuotes]).toEqual([
		23,
		23,
		2,
		true
	]);
	const last = await listQuotes(db, { page: '9' }, SALES);
	expect([last.filters.page, last.quotes.map((quote) => quote.id)]).toEqual([2, [3, 2, 1]]);
	const none = await listQuotes(db, { state: 'EXPIRED' }, SALES);
	expect([none.total, none.hasQuotes]).toEqual([0, true]);
});

test('WAREHOUSE and DRIVER get a 403 on the list', async () => {
	for (const actor of [WAREHOUSE, DRIVER]) {
		const refusal = await listQuotes(db, {}, actor).catch((caught) => caught);
		expect(isHttpError(refusal, 403)).toBe(true);
	}
});

test('the detail names the lines whose product was deactivated since: they stay on the quote', async () => {
	const id = await fixture.quote(quote1043);
	expect((await getQuoteDetail(db, id, SALES))?.inactiveProductIds).toEqual([]);
	await editProduct(2, { active: 'off' });
	const quote = await getQuoteDetail(db, id, SALES);
	expect([quote?.inactiveProductIds, quote?.items.length]).toEqual([[2], 3]);
	expect(await getQuoteDetail(db, 99, SALES)).toBeNull();
});

test('the timeline lists created, edited and converted, newest first, without before or after', async () => {
	const created = await createQuote(db, quote1043, SALES);
	const id = created.ok ? created.id : 0;
	await updateQuote(db, { ...quote1043, id, discount: 0 }, SALES);
	const converted = await convertQuote(db, { quote: id, order: orderInput() }, MANAGER);
	const orderId = converted.ok ? converted.id : 0;
	const entries = await getQuoteTimeline(db, id, SALES);
	expect(
		entries?.map(({ action, orderId, actorUsername }) => [action, orderId, actorUsername])
	).toEqual([
		['CONVERTED', orderId, 'manager'],
		['EDITED', null, 'sales'],
		['CREATED', null, 'sales']
	]);
	expect(Object.keys(entries?.[0] ?? {}).sort()).toEqual([
		'action',
		'actorUsername',
		'createdAt',
		'id',
		'orderId'
	]);
	expect(await getQuoteTimeline(db, 99, SALES)).toBeNull();
});

test('an edit opens into its changes: Spanish labels, «Sin fecha», «Por acordar», lines per product', async () => {
	const id = await fixture.quote(quote1043);
	const items = [quote1043.quote_items[0], { ...quote1043.quote_items[1], qty: 15 }];
	const edit = { ...quote1043, id, event_date: '', transport_cost: null, quote_items: items };
	await updateQuote(db, { ...edit, notes: 'Llamar antes' }, SALES);
	const [edited] = database.prepare("select id from events where action = 'EDITED'").all();
	const changes = await getQuoteChange(db, { quote: id, event: edited.id }, SALES);
	expect(changes).toEqual([
		{ label: 'Fecha del evento', change: '12 dic 2026 → Sin fecha' },
		{ label: 'Mesa redonda 10 puestos', change: 'Cantidad 12 → 15' },
		{ label: 'Copa para vino tinto', change: 'Quitada: 120 × $900' },
		{ label: 'Transporte', change: '$180.000 → Por acordar' },
		{ label: 'Notas', change: 'Precios incluyen montaje y desmontaje → Llamar antes' }
	]);
	const [created] = database.prepare("select id from events where action = 'CREATED'").all();
	expect(await getQuoteChange(db, { quote: id, event: created.id }, SALES)).toBeNull();
	expect(await getQuoteChange(db, { quote: 99, event: edited.id }, SALES)).toBeNull();
});

test('an edit of «Quién transporta» opens into its change, after the place', async () => {
	const id = await fixture.quote(quote1043);
	const edit = { ...quote1043, id, address_2: null, transported_by: 'CLIENT' };
	await updateQuote(db, edit, SALES);
	const [edited] = database.prepare("select id from events where action = 'EDITED'").all();
	expect(await getQuoteChange(db, { quote: id, event: edited.id }, SALES)).toEqual([
		{
			label: 'Lugar del evento, segunda línea',
			change: 'Salón Social Torre Verde, piso 2 → —'
		},
		{ label: 'Quién transporta', change: 'La empresa → El cliente' }
	]);
});

test('WAREHOUSE and DRIVER get a 403 on the detail, the timeline and an edit’s changes', async () => {
	const id = await fixture.quote(quote1043);
	for (const actor of [WAREHOUSE, DRIVER]) {
		const attempts = [
			getQuoteDetail(db, id, actor),
			getQuoteTimeline(db, id, actor),
			getQuoteChange(db, { quote: id, event: 1 }, actor)
		];
		for (const attempt of attempts) {
			expect(isHttpError(await attempt.catch((caught) => caught), 403)).toBe(true);
		}
	}
});

test('the form adds lines from the active catalog only: «Silla Rimax» is out', async () => {
	const { products } = await getQuoteFormOptions(db, SALES);
	expect(products.map((product) => product.name)).toEqual([
		'Copa para vino tinto',
		'Mesa redonda 10 puestos',
		'Silla Tiffany dorada'
	]);
});

function readQuoteRow(id: number) {
	return database.prepare('select * from quotes where id = ?').get(id);
}

function countRows() {
	return database
		.prepare(
			'select (select count(*) from quotes) as quotes, (select count(*) from events) as events'
		)
		.get();
}

test('«Duplicar» reprices every line from today’s catalog: name, list price and price to charge', async () => {
	// Quoted at list $2.500 and charged $2.200; the product now lists at $2.800 under a new name.
	const lines = [{ product_id: 1, qty: 120, unit_price: 2200 }];
	const id = await fixture.quote({ ...quote1043, quote_items: lines, discount: 0 });
	await editProduct(1, { name: 'Silla Tiffany oro', rental_price: '2800' });
	const copy = await getQuoteDuplicate(db, id, SALES);
	expect(copy?.draft.items).toEqual([
		{
			product_id: 1,
			name: 'Silla Tiffany oro',
			qty: 120,
			list_price: 2800,
			unit_price: 2800,
			line_total: 120 * 2800 * 2
		}
	]);
	expect(copy).toMatchObject({
		source: { kind: 'QUOTE', id },
		removed: [],
		draft: {
			clientId: LUZ_MARINA,
			address1: quote1043.address_1,
			rentalDays: 2,
			discount: 0,
			transportCost: 180000,
			notes: quote1043.notes
		}
	});
});

test('«Duplicar» keeps «por acordar», and leaves inactive products out, naming them', async () => {
	const items = [...quote1043.quote_items, { product_id: RIMAX, qty: 10, unit_price: 1500 }];
	await editProduct(RIMAX, { active: 'on' });
	const id = await fixture.quote({ ...quote1043, quote_items: items, transport_cost: null });
	await editProduct(2, { active: 'off' });
	await editProduct(RIMAX, { active: 'off' });
	const copy = await getQuoteDuplicate(db, id, SALES);
	expect(copy?.draft.transportCost).toBeNull();
	expect(copy?.draft.items.map((item) => item.product_id)).toEqual([1, 3]);
	expect(copy?.removed).toEqual(['Mesa redonda 10 puestos', 'Silla Rimax']);
});

test('a quote whose every product is inactive opens empty, and saving it needs a line', async () => {
	const id = await fixture.quote(quote1043);
	for (const productId of [1, 2, 3]) {
		await editProduct(productId, { active: 'off' });
	}
	const copy = await getQuoteDuplicate(db, id, SALES);
	expect([copy?.draft.items, copy?.removed.length]).toEqual([[], 3]);
	const result = await createQuote(db, { ...quote1043, quote_items: [] }, SALES);
	expect(errorsOf(result)).toMatchObject({ quote_items: 'Agrega al menos un producto' });
});

// What the form posts back from a duplicate's draft, with today's «Válida hasta» and no event date.
function draftInput(draft: QuoteDraft) {
	return {
		client_id: draft.clientId,
		client_name: draft.client.name,
		event_date: '',
		valid_until: '2026-12-01',
		rental_days: draft.rentalDays,
		quote_items: draft.items.map((item) => ({
			product_id: item.product_id,
			qty: item.qty,
			unit_price: item.unit_price
		})),
		discount: draft.discount,
		transport_cost: draft.transportCost,
		transported_by: draft.transportedBy,
		address_1: draft.address1,
		address_2: draft.address2,
		notes: draft.notes
	};
}

test('nothing is written until saved; the copy takes the next number and leaves the original as it was', async () => {
	const id = await fixture.quote(quote1043);
	const original = readQuoteRow(id);
	const before = countRows();
	const copy = await getQuoteDuplicate(db, id, SALES);
	expect(countRows()).toEqual(before);
	expect(await getQuoteDuplicate(db, 99, SALES)).toBeNull();
	if (null === copy) {
		throw new Error('No copy');
	}
	expect(await fixture.quote(draftInput(copy.draft))).toBe(id + 1);
	expect(readQuoteRow(id)).toEqual(original);
	const events = database
		.prepare("select entity_id, action from events where entity_type = 'QUOTE' order by id")
		.all();
	expect(events).toEqual([
		{ entity_id: id, action: 'CREATED' },
		{ entity_id: id + 1, action: 'CREATED' }
	]);
});

test('the client link token is set once: editing keeps it, a duplicate gets its own', async () => {
	const id = await fixture.quote(quote1043);
	const token = await getQuotePublicToken(db, id, SALES);
	expect(String(token)).toMatch(/^[0-9a-z]{13}$/);
	expect(await updateQuote(db, { ...quote1043, id, discount: 0 }, SALES)).toMatchObject({
		ok: true
	});
	expect(await getQuotePublicToken(db, id, SALES)).toBe(token);
	const copy = await getQuoteDuplicate(db, id, SALES);
	const duplicate = await fixture.quote(draftInput(copy?.draft as QuoteDraft));
	expect(await getQuotePublicToken(db, duplicate, SALES)).not.toBe(token);
	const events = database.prepare('select after from events').all();
	expect(JSON.stringify(events)).not.toContain(String(token));
	for (const actor of [WAREHOUSE, DRIVER]) {
		const refusal = await getQuotePublicToken(db, id, actor).catch((caught) => caught);
		expect(isHttpError(refusal, 403)).toBe(true);
	}
});

test('WAREHOUSE and DRIVER get a 403 duplicating', async () => {
	const id = await fixture.quote(quote1043);
	for (const actor of [WAREHOUSE, DRIVER]) {
		const refusal = await getQuoteDuplicate(db, id, actor).catch((caught) => caught);
		expect(isHttpError(refusal, 403)).toBe(true);
	}
});

// The order form as «Convertir en pedido» fills it from quote1043, with the trips typed in.
function orderInput(overrides: object = {}) {
	const trip = { address_1: quote1043.address_1, address_2: quote1043.address_2 };
	return {
		client_id: LUZ_MARINA,
		client_name: 'Luz Marina Restrepo',
		event_date: '2026-12-12',
		delivery_date: '2026-12-11',
		pickup_date: '2026-12-13',
		rental_days: 2,
		delivery_attributes: { ...trip, method: 'COMPANY_DELIVERY' },
		pickup_attributes: { ...trip, method: 'COMPANY_PICKUP' },
		order_items: quote1043.quote_items,
		discount: 104000,
		transport_cost: 180000,
		notes: quote1043.notes,
		...overrides
	};
}

async function convert(quote: number, overrides: object = {}): Promise<number> {
	const result = await convertQuote(db, { quote, order: orderInput(overrides) }, SALES);
	if (!result.ok) {
		throw new Error(JSON.stringify(result));
	}
	return result.id;
}

function countOrders() {
	return database.prepare('select count(*) as orders from orders').get();
}

test('the form opens filled from the quote, with its client as the contact is today, and writes nothing', async () => {
	const id = await fixture.quote(quote1043);
	await editContact(LUZ_MARINA, { full_name: 'Luz Marina Restrepo Gil' });
	const before = { ...countRows(), ...countOrders() };
	const conversion = await getQuoteConversion(db, id, SALES);
	expect(conversion).toMatchObject({
		quote: { id, state: 'VALID', rentalDays: 2, discount: 104000, transportCost: 180000 },
		client: { id: LUZ_MARINA, fullName: 'Luz Marina Restrepo Gil', phone: '573104428890' }
	});
	// The holidays' dates, which the form's default delivery and pickup skip.
	expect(conversion?.holidayDates).toContain('2026-12-08');
	expect({ ...countRows(), ...countOrders() }).toEqual(before);
	expect((await read(id)).state).toBe('VALID');
	expect(await getQuoteConversion(db, 99, SALES)).toBeNull();
});

test('the conversion marks a client carrying Vetado, for the warning under «Cliente»', async () => {
	const id = await fixture.quote(quote1043);
	expect((await getQuoteConversion(db, id, SALES))?.client.isBanned).toBe(false);
	await editContact(LUZ_MARINA, { labels: ['BANNED'] });
	expect((await getQuoteConversion(db, id, SALES))?.client.isBanned).toBe(true);
});

test('a client carrying Vetado saves a quote like any other, with no extra step', async () => {
	await editContact(LUZ_MARINA, { labels: ['BANNED'] });
	expect((await read(await fixture.quote(quote1043))).clientId).toBe(LUZ_MARINA);
});

test('saving creates a CONFIRMED order and links the quote, with ORDER CREATED and QUOTE CONVERTED', async () => {
	const id = await fixture.quote(quote1043);
	const orderId = await convert(id);
	expect(await getOrder(db, orderId, SALES)).toMatchObject({
		status: 'CONFIRMED',
		clientId: LUZ_MARINA,
		orderTotal: 1180000
	});
	expect(await read(id)).toMatchObject({ orderId, state: 'CONVERTED' });
	const events = database
		.prepare(
			"select entity_type, entity_id, action, before, after from events where action != 'CREATED' or entity_type = 'ORDER'"
		)
		.all();
	expect(events).toEqual([
		expect.objectContaining({ entity_type: 'ORDER', entity_id: orderId, action: 'CREATED' }),
		{
			entity_type: 'QUOTE',
			entity_id: id,
			action: 'CONVERTED',
			before: '{"order_id":null}',
			after: `{"order_id":${orderId}}`
		}
	]);
	expect(await getSourceQuoteId(db, orderId, SALES)).toBe(id);
});

test('the lines come exactly as quoted, a product deactivated since included', async () => {
	const lines = [
		{ product_id: 1, qty: 120, unit_price: 2200 },
		{ product_id: 3, qty: 120, unit_price: 900 }
	];
	const id = await fixture.quote({ ...quote1043, quote_items: lines, discount: 0 });
	await editProduct(1, { name: 'Silla Tiffany', rental_price: '2800' });
	await editProduct(3, { active: 'off' });
	const orderId = await convert(id, { order_items: lines, discount: 0 });
	const order = await getOrder(db, orderId, SALES);
	expect(order?.items.map((item) => [item.name, item.list_price, item.unit_price])).toEqual([
		['Silla Tiffany dorada', 2500, 2200],
		['Copa para vino tinto', 900, 900]
	]);
});

test('a «por acordar» transport has to be typed before saving; 0 saves', async () => {
	const id = await fixture.quote({ ...quote1043, transport_cost: null });
	const empty = await convertQuote(
		db,
		{ quote: id, order: orderInput({ transport_cost: undefined }) },
		SALES
	);
	expect(empty).toMatchObject({ ok: false, errors: { transport_cost: expect.any(String) } });
	expect(countOrders()).toEqual({ orders: 0 });
	expect((await read(id)).state).toBe('VALID');
	const orderId = await convert(id, { transport_cost: 0 });
	expect(await getOrder(db, orderId, SALES)).toMatchObject({
		transportCost: 0,
		orderTotal: 1000000
	});
});

test("a converted quote, or one that doesn't exist, isn't converted", async () => {
	const id = await fixture.quote(quote1043);
	await convert(id);
	const again = await convertQuote(db, { quote: id, order: orderInput() }, SALES);
	expect(again).toMatchObject({ ok: false, message: expect.stringContaining('ya se convirtió') });
	const missing = await convertQuote(db, { quote: 99, order: orderInput() }, SALES);
	expect(missing).toMatchObject({ ok: false, message: 'Esa cotización no existe' });
	expect(countOrders()).toEqual({ orders: 1 });
});

test("the order's CREATED event carries CONFIRMED, and no STATUS_CHANGED follows it", async () => {
	const orderId = await convert(await fixture.quote(quote1043));
	const events = database
		.prepare("select action, after from events where entity_type = 'ORDER' and entity_id = ?")
		.all(orderId);
	expect(events.map((event) => event.action)).toEqual(['CREATED']);
	expect(JSON.parse(String(events[0].after))).toMatchObject({ status: 'CONFIRMED' });
});

test('saving checks availability once: what is short comes back, «Guardar de todos modos» saves', async () => {
	const id = await fixture.quote(quote1043);
	const count = { items: [{ product_id: 1, counted_qty: 100 }] };
	expect(await submitAndApproveCount(db, count, MANAGER)).toMatchObject({ ok: true });
	const short = await convertQuote(db, { quote: id, order: orderInput() }, SALES);
	expect(short).toMatchObject({
		ok: false,
		shortages: [{ productId: 1, name: 'Silla Tiffany dorada', short: 20 }]
	});
	expect(countOrders()).toEqual({ orders: 0 });
	expect((await read(id)).state).toBe('VALID');
	const forced = await convertQuote(db, { quote: id, order: orderInput(), force: true }, SALES);
	expect(forced).toMatchObject({ ok: true });
	expect(countOrders()).toEqual({ orders: 1 });
});

test('with nothing short it saves at once, and with $0 paid it offers «Registrar pago»', async () => {
	const result = await convertQuote(
		db,
		{ quote: await fixture.quote(quote1043), order: orderInput() },
		SALES
	);
	if (!result.ok) {
		throw new Error(JSON.stringify(result));
	}
	const detail = await getOrderDetail(db, result.id, SALES);
	if (null === detail) {
		throw new Error('No order');
	}
	expect(detail).toMatchObject({ status: 'CONFIRMED', paid: 0 });
	expect(offeredPaymentConcepts(detail, SALES)).toContain('INSTALLMENT');
});

test("an expired quote isn't converted: it's renewed first", async () => {
	const id = await fixture.quote(quote1043);
	vi.setSystemTime(new Date('2026-12-02T15:00:00Z'));
	const result = await convertQuote(db, { quote: id, order: orderInput() }, SALES);
	expect(result).toMatchObject({ ok: false, message: expect.stringContaining('vencida') });
	expect(countOrders()).toEqual({ orders: 0 });
});

test('cancelling the order leaves the quote converted', async () => {
	const id = await fixture.quote(quote1043);
	const orderId = await convert(id);
	const reason = 'El cliente aplazó el evento';
	expect(await cancelOrder(db, { id: orderId, reason }, SALES)).toMatchObject({ ok: true });
	expect(await read(id)).toMatchObject({ orderId, state: 'CONVERTED' });
});

test('an order that came from no quote has no source quote', async () => {
	const id = await fixture.quote(quote1043);
	await convert(id);
	expect(await getSourceQuoteId(db, 99, SALES)).toBeNull();
});

// «Cotizar de nuevo»: order #1 from quote1043, its lines charged below list, then the catalog moves.
async function requotedOrder(status: OrderStatus = 'CONFIRMED') {
	const lines = [
		{ product_id: 1, qty: 120, unit_price: 2200 },
		{ product_id: 2, qty: 12, unit_price: 12000 }
	];
	const delivery = { address_1: 'Cra 70 #44-21, Laureles', address_2: 'Salón de eventos' };
	const orderId = await fixture.order({
		status,
		client_id: LUZ_MARINA,
		rental_days: 2,
		order_items: lines,
		discount: 50000,
		transport_cost: 90000,
		notes: 'Entrar por el portón de servicio',
		delivery_attributes: { ...delivery, method: 'COMPANY_DELIVERY' }
	});
	await editProduct(1, { name: 'Silla Tiffany oro', rental_price: '2800' });
	await editProduct(2, { active: 'off' });
	return orderId;
}

test('«Cotizar de nuevo» fills the quote from the order at today’s prices, in any state', async () => {
	for (const status of ['CONFIRMED', 'COMPLETED', 'CANCELLED'] satisfies OrderStatus[]) {
		const orderId = await requotedOrder(status);
		const copy = await getOrderRequote(db, String(orderId), SALES);
		expect(copy).toEqual({
			source: { kind: 'ORDER', id: orderId },
			removed: ['Mesa redonda 10 puestos'],
			draft: {
				clientId: LUZ_MARINA,
				client: { name: 'Luz Marina Restrepo', phone: '573104428890', whatsapp: null },
				address1: 'Cra 70 #44-21, Laureles',
				address2: 'Salón de eventos',
				rentalDays: 2,
				discount: 50000,
				transportCost: 90000,
				transportedBy: 'COMPANY',
				notes: 'Entrar por el portón de servicio',
				items: [
					{
						product_id: 1,
						name: 'Silla Tiffany oro',
						qty: 120,
						list_price: 2800,
						unit_price: 2800,
						line_total: 120 * 2800 * 2
					}
				]
			}
		});
		await editProduct(1, { name: 'Silla Tiffany dorada', rental_price: '2500' });
		await editProduct(2, { active: 'on' });
	}
});

test('«Cotizar de nuevo» writes nothing; the saved quote has its own token and no link to the order', async () => {
	const orderId = await requotedOrder('CANCELLED');
	const order = database.prepare('select * from orders where id = ?').get(orderId);
	const before = countRows();
	const copy = await getOrderRequote(db, orderId, SALES);
	expect(countRows()).toEqual(before);
	if (null === copy) {
		throw new Error('No copy');
	}
	const id = await fixture.quote(draftInput(copy.draft));
	const row = readQuoteRow(id);
	expect(row?.order_id).toBeNull();
	expect(row?.event_date).toBeNull();
	const tokens = database.prepare('select public_token from quotes').all();
	expect(new Set(tokens.map((each) => each.public_token)).size).toBe(tokens.length);
	expect(database.prepare('select * from orders where id = ?').get(orderId)).toEqual(order);
});

test('«Cotizar de nuevo»: no such order is null, and WAREHOUSE and DRIVER get a 403', async () => {
	expect(await getOrderRequote(db, 99, SALES)).toBeNull();
	expect(await getOrderRequote(db, 'x', SALES)).toBeNull();
	const orderId = await requotedOrder();
	for (const actor of [WAREHOUSE, DRIVER]) {
		const refusal = await getOrderRequote(db, orderId, actor).catch((caught) => caught);
		expect(isHttpError(refusal, 403)).toBe(true);
	}
});

test('a new quote is valid through Bogotá’s today plus QUOTES_VALIDITY_DAYS, at 11:30 p.m. too', async () => {
	vi.setSystemTime(new Date('2026-11-01T04:30:00Z')); // 11:30 p.m. on 31 October in Bogotá
	const setting = database
		.prepare("select value from settings where key = 'QUOTES_VALIDITY_DAYS'")
		.get();
	expect((await getQuoteFormOptions(db, SALES)).validUntil).toBe(
		addDays('2026-10-31', Number(setting?.value))
	);
});

test('DRIVER gets a 403 converting a quote; SALES converts it', async () => {
	const id = await fixture.quote(quote1043);
	const refusal = await convertQuote(db, { quote: id, order: orderInput() }, DRIVER).catch(
		(caught) => caught
	);
	expect(isHttpError(refusal, 403)).toBe(true);
	expect(countOrders()).toEqual({ orders: 0 });
	expect(await convert(id)).toBeGreaterThan(0);
});

test("the printout carries the contact's document as it is when printed, and none for an automatic one", async () => {
	// «Cliente nuevo» leaves an automatic document, which Sales fills in from Contactos.
	const fresh = { client_id: null, client_name: 'Colegio San José', client_phone: '604 444 1500' };
	const id = await fixture.quote({ ...quote1043, ...fresh });
	expect(await getQuotePrintout(db, id, SALES)).toMatchObject({
		quote: { id },
		document: null,
		company: { COMPANY_NAME: expect.any(String) }
	});
	const { clientId } = await read(id);
	await editContact(Number(clientId), { document_id: '43521789' }, SALES);
	expect((await getQuotePrintout(db, id, SALES))?.document).toBe('43521789');
	expect(await getQuotePrintout(db, 99, SALES)).toBeNull();
});

test('WAREHOUSE and DRIVER get a 403 on the printout', async () => {
	const id = await fixture.quote(quote1043);
	for (const actor of [WAREHOUSE, DRIVER]) {
		const refusal = await getQuotePrintout(db, id, actor).catch((caught) => caught);
		expect(isHttpError(refusal, 403)).toBe(true);
	}
});

test('«Quién transporta» is saved and edited; left out, a new quote is the company; it never touches transport', async () => {
	const pending = await fixture.quote({
		...quote1043,
		transport_cost: null,
		transported_by: 'CLIENT'
	});
	expect(await read(pending)).toMatchObject({ transportedBy: 'CLIENT', transportCost: null });
	const edit = { ...quote1043, id: pending, transport_cost: null, transported_by: 'COMPANY' };
	expect(await updateQuote(db, edit, SALES)).toMatchObject({ ok: true });
	expect(await read(pending)).toMatchObject({ transportedBy: 'COMPANY', transportCost: null });
	const free = await fixture.quote({ ...quote1043, transport_cost: 0, transported_by: 'CLIENT' });
	expect(await read(free)).toMatchObject({ transportedBy: 'CLIENT', transportCost: 0 });
	expect((await read(await fixture.quote(quote1043))).transportedBy).toBe('COMPANY');
});

test('«Quién transporta» is required: empty or anything but the company or the client fails on its field', async () => {
	for (const transportedBy of [undefined, null, '', 'EXTERNAL_CARRIER']) {
		const result = await createQuote(db, { ...quote1043, transported_by: transportedBy }, SALES);
		expect(errorsOf(result)).toEqual({ transported_by: 'Escoge quién transporta' });
	}
});

test('«Duplicar» copies who transports', async () => {
	const id = await fixture.quote({ ...quote1043, transported_by: 'CLIENT' });
	expect((await getQuoteDuplicate(db, id, SALES))?.draft.transportedBy).toBe('CLIENT');
});

test('«Cotizar de nuevo» reads who transports from the delivery method: a client pickup is the client', async () => {
	const pickedUp = await convert(await fixture.quote(quote1043), {
		delivery_attributes: { address_1: quote1043.address_1, method: 'CLIENT_PICKUP' },
		pickup_attributes: { address_1: quote1043.address_1, method: 'COMPANY_PICKUP' }
	});
	expect((await getOrderRequote(db, pickedUp, SALES))?.draft.transportedBy).toBe('CLIENT');
	const mixed = await convert(await fixture.quote(quote1043), {
		pickup_attributes: { address_1: quote1043.address_1, method: 'CLIENT_RETURN' }
	});
	expect((await getOrderRequote(db, mixed, SALES))?.draft.transportedBy).toBe('COMPANY');
});

test('«Convertir en pedido» fills both methods from who transports; the order keeps no copy of it', async () => {
	const byClient = await fixture.quote({ ...quote1043, transported_by: 'CLIENT' });
	expect((await getQuoteConversion(db, byClient, SALES))?.methods).toEqual({
		deliveryMethod: 'CLIENT_PICKUP',
		returnMethod: 'CLIENT_RETURN'
	});
	const byCompany = await fixture.quote(quote1043);
	expect((await getQuoteConversion(db, byCompany, SALES))?.methods).toEqual({
		deliveryMethod: 'COMPANY_DELIVERY',
		returnMethod: 'COMPANY_PICKUP'
	});
	const orderId = await convert(byClient);
	expect(JSON.stringify(await getOrder(db, orderId, SALES))).not.toContain('transported');
});

// quote1043 converted: an order of 120 Tiffany chairs, delivered 11 December, picked up the 13th.
test("the form's availability counts from the day before the event to the day after", async () => {
	await convert(await fixture.quote(quote1043));
	const chairsFor = async (eventDate: string) => {
		const availability = await getQuoteAvailability(db, { event_date: eventDate }, SALES);
		return availability?.find(({ productId }) => 1 === productId)?.available;
	};
	expect(await chairsFor('2026-12-09')).toBe(500);
	expect(await chairsFor('2026-12-10')).toBe(380);
	expect(await chairsFor('2026-12-14')).toBe(380);
	expect(await chairsFor('2026-12-15')).toBe(500);
});

test('without an event date the form gets no availability, and a saved quote reserves nothing', async () => {
	await fixture.quote(quote1043);
	expect(await getQuoteAvailability(db, { event_date: '' }, SALES)).toBeNull();
	expect(await getQuoteAvailability(db, { event_date: null }, SALES)).toBeNull();
	const availability = await getQuoteAvailability(db, { event_date: '2026-12-12' }, SALES);
	expect(availability?.find(({ productId }) => 1 === productId)?.available).toBe(500);
});

test("WAREHOUSE and DRIVER get a 403 asking for the quote form's availability", async () => {
	for (const actor of [WAREHOUSE, DRIVER]) {
		const refusal = await getQuoteAvailability(db, { event_date: '2026-12-12' }, actor).catch(
			(caught: unknown) => caught
		);
		expect(isHttpError(refusal, 403)).toBe(true);
	}
});
