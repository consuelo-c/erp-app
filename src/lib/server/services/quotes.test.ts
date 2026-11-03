import { isHttpError } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import {
	createQuote,
	getNewQuoteValidUntil,
	getQuote,
	quoteAttributesSchema,
	updateQuote
} from './quotes';

const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };
const warehouse: Actor = {
	username: 'bodega',
	employeeId: null,
	roles: ['WAREHOUSE'],
	kind: 'user'
};
const driver: Actor = { username: 'conductor', employeeId: null, roles: ['DRIVER'], kind: 'user' };

let db: D1Database;
let database: DatabaseSync;

const AUDIT = "0, 'admin', 0, 'admin'";

function insertContact(fullName: string, phone: string) {
	database
		.prepare(
			`insert into contacts (phone, full_name, document_id, created_at, created_by, updated_at, updated_by) values (?, ?, ?, ${AUDIT})`
		)
		.run(phone, fullName, `@${phone}`);
}

function insertProduct(name: string, rentalPrice: number, active = 1) {
	database
		.prepare(
			`insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values (?, 'CHAIRS_TABLES', ?, 500, ?, ${AUDIT})`
		)
		.run(name, rentalPrice, active);
}

// The clock on Sunday 1 November 2026, 10:00 a.m. in Bogotá.
const NOVEMBER_1 = new Date('2026-11-01T15:00:00Z');

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOVEMBER_1);
	({ db, database } = createMemoryD1());
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	insertContact('Postobón S.A.', '576045765100');
	insertContact('Luz Marina Restrepo', '573104428890');
	insertProduct('Silla Tiffany dorada', 2500);
	insertProduct('Mesa redonda 10 puestos', 12000);
	insertProduct('Copa para vino tinto', 900);
	insertProduct('Silla Rimax', 1500, 0);
});

afterEach(() => {
	vi.useRealTimers();
});

const POSTOBON = 1;
const LUZ_MARINA = 2;
const RIMAX = 4;

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
	address_1: 'Cra 43A #18-95, El Poblado',
	address_2: 'Salón Social Torre Verde, piso 2',
	notes: 'Precios incluyen montaje y desmontaje'
};

async function create(input: object = quote1043): Promise<number> {
	const result = await createQuote(db, input, sales);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	return result.id;
}

async function read(id: number) {
	const quote = await getQuote(db, id, sales);
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
	const id = await create({ ...quote1043, items_total: 1, quote_total: 1 });
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
	const open = await read(await create({ ...quote1043, transport_cost: null }));
	expect([open.transportCost, open.quoteTotal]).toEqual([null, 1104000 - 104000]);
	const omitted = { ...quote1043 } as Partial<typeof quote1043>;
	delete omitted.transport_cost;
	expect((await read(await create(omitted))).transportCost).toBeNull();
	const free = await read(await create({ ...quote1043, transport_cost: 0 }));
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
			errorsOf(await createQuote(db, { ...quote1043, discount: 0, ...change }, sales))
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
			errorsOf(await createQuote(db, { ...quote1043, ...change }, sales))
		)
	);
	expect(errors).toEqual([
		{ discount: 'El descuento no puede ser mayor que el subtotal' },
		{ discount: 'No puede ser negativo' },
		{ transport_cost: 'No puede ser negativo' }
	]);
	expect((await read(await create({ ...quote1043, discount: 1104000 }))).quoteTotal).toBe(180000);
});

test('rental days are a whole number of at least 1', async () => {
	for (const rentalDays of [0, 1.5]) {
		const input = { ...quote1043, rental_days: rentalDays, discount: 0 };
		const result = await createQuote(db, input, sales);
		expect(Object.keys(errorsOf(result))).toEqual(['rental_days']);
	}
});

test('the event date and «Lugar del evento» are optional; a second line needs the first', async () => {
	const bare = { ...quote1043, event_date: '', address_1: '', address_2: '', notes: '' };
	const quote = await read(await create(bare));
	expect([quote.eventDate, quote.address1, quote.address2, quote.notes]).toEqual([
		null,
		null,
		null,
		null
	]);
	expect(database.prepare('select attributes from quotes').get()).toEqual({ attributes: '{}' });
	const result = await createQuote(db, { ...bare, address_2: 'Salón principal' }, sales);
	expect(errorsOf(result)).toEqual({ address_1: 'Escribe la primera línea de la dirección' });
});

test('with the clock on 1 November 2026 and the key at 30, a new quote is valid until 1 December', async () => {
	expect(await getNewQuoteValidUntil(db, sales)).toBe('2026-12-01');
	database.exec("update settings set value = '15' where key = 'QUOTES_VALIDITY_DAYS'");
	expect(await getNewQuoteValidUntil(db, sales)).toBe('2026-11-16');
});

test('«Válida hasta» is required and never before the creation day, on create and on edit', async () => {
	const missing = { ...quote1043 } as Partial<typeof quote1043>;
	delete missing.valid_until;
	expect(Object.keys(errorsOf(await createQuote(db, missing, sales)))).toEqual(['valid_until']);
	const tooSoon = await createQuote(db, { ...quote1043, valid_until: '2026-10-31' }, sales);
	const message = 'No puede ser antes del día en que se hizo la cotización';
	expect(errorsOf(tooSoon)).toEqual({ valid_until: message });
	const id = await create({ ...quote1043, valid_until: '2026-11-01' });
	// Ten days later the creation day still saves; the day before it doesn't.
	vi.setSystemTime(new Date('2026-11-11T15:00:00Z'));
	expect((await read(id)).state).toBe('EXPIRED');
	const edit = { ...quote1043, id, valid_until: '2026-10-31' };
	expect(errorsOf(await updateQuote(db, edit, sales))).toEqual({ valid_until: message });
	expect(
		await updateQuote(db, { ...edit, valid_until: '2026-11-01', rental_days: 1 }, sales)
	).toEqual({ ok: true, id });
});

test('an expired quote is renewed by editing it: a new «Válida hasta»', async () => {
	const id = await create();
	vi.setSystemTime(new Date('2026-12-02T15:00:00Z'));
	expect((await read(id)).state).toBe('EXPIRED');
	await updateQuote(db, { ...quote1043, id, valid_until: '2027-01-01' }, sales);
	expect((await read(id)).state).toBe('VALID');
});

test('«Cliente nuevo» creates its contact, automatic document, in the same batch, linked', async () => {
	const input = {
		...quote1043,
		client_id: null,
		client_name: 'Colegio San José',
		client_phone: '604 444 1500'
	};
	const id = await create(input);
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
	expect(created).toEqual([
		{ entity_type: 'CONTACT', action: 'CREATED' },
		{ entity_type: 'QUOTE', action: 'CREATED' }
	]);
	const refused = await createQuote(db, { ...input, client_phone: '123' }, sales);
	expect(Object.keys(errorsOf(refused))).toEqual(['client_phone']);
});

test("the client's name and phone are the quote's snapshot: renaming the contact changes nothing", async () => {
	const id = await create({ ...quote1043, client_name: 'Luz Marina Restrepo (mamá de la novia)' });
	database.exec(
		`update contacts set full_name = 'Luz M. Restrepo', phone = '573000000000' where id = ${LUZ_MARINA}`
	);
	expect((await read(id)).client).toEqual({
		name: 'Luz Marina Restrepo (mamá de la novia)',
		phone: '573104428890'
	});
	const contact = database.prepare(`select full_name from contacts where id = ${LUZ_MARINA}`).get();
	expect(contact).toEqual({ full_name: 'Luz M. Restrepo' });
});

test('creating logs a QUOTE CREATED event; created_by and updated_by are the actor', async () => {
	const id = await create();
	expect(quoteEvents()).toEqual([expect.objectContaining({ action: 'CREATED', before: null })]);
	const row = database.prepare('select created_by, updated_by from quotes where id = ?').get(id);
	expect(row).toEqual({ created_by: 'ventas', updated_by: 'ventas' });
});

test('an edit logs only the changed fields; a save with no change logs nothing', async () => {
	const id = await create();
	expect(await updateQuote(db, { ...quote1043, id }, sales)).toEqual({ ok: true, id });
	expect(quoteEvents()).toHaveLength(1);
	await updateQuote(db, { ...quote1043, id, discount: 0, transport_cost: null }, sales);
	expect(quoteEvents()[1]).toEqual({
		action: 'EDITED',
		before: { discount: 104000, transport_cost: 180000, quote_total: 1180000 },
		after: { discount: 0, transport_cost: null, quote_total: 1104000 }
	});
});

test('lines already on the quote keep their frozen name and price; an added line takes today’s', async () => {
	const id = await create();
	database.exec("update products set name = 'Silla Tiffany', rental_price = 2800 where id = 1");
	database.exec('update products set rental_price = 1000 where id = 3');
	const items = [quote1043.quote_items[0], { product_id: 3, qty: 50, unit_price: 1000 }];
	await updateQuote(db, { ...quote1043, id, quote_items: items }, sales);
	const lines = (await read(id)).items;
	expect(lines.map((line) => [line.name, line.list_price, line.unit_price])).toEqual([
		['Silla Tiffany dorada', 2500, 2500],
		['Copa para vino tinto', 900, 1000]
	]);
});

test('changing the client changes client_id and its snapshot together', async () => {
	const id = await create();
	await updateQuote(
		db,
		{ ...quote1043, id, client_id: POSTOBON, client_name: 'Postobón S.A.' },
		sales
	);
	expect(await read(id)).toMatchObject({
		clientId: POSTOBON,
		client: { name: 'Postobón S.A.', phone: '576045765100' }
	});
	expect(Object.keys(quoteEvents()[1].after).sort()).toEqual(['client_attributes', 'client_id']);
});

test("a converted quote can't be edited, and a quote that doesn't exist neither", async () => {
	const id = await create();
	database.exec(
		`insert into orders (id, public_token, client_id, status, event_date, delivery_date, pickup_date, rental_days, client_attributes, delivery_attributes, pickup_attributes, order_items, items_total, order_total, created_at, created_by, updated_at, updated_by)
		values (1060, 'token', ${LUZ_MARINA}, 'DRAFT', '2026-12-12', '2026-12-11', '2026-12-13', 2, '{}', '{"method":"COMPANY_DELIVERY"}', '{"method":"COMPANY_PICKUP"}', '[]', 0, 0, ${AUDIT})`
	);
	database.exec(`update quotes set order_id = 1060 where id = ${id}`);
	expect((await read(id)).state).toBe('CONVERTED');
	const result = await updateQuote(db, { ...quote1043, id, discount: 0 }, sales);
	expect(result).toMatchObject({ ok: false, message: expect.stringContaining('ya se convirtió') });
	expect((await read(id)).discount).toBe(104000);
	expect(await updateQuote(db, { ...quote1043, id: 99 }, sales)).toMatchObject({ ok: false });
	expect(await getQuote(db, 99, sales)).toBeNull();
});

test('WAREHOUSE and DRIVER get a 403 creating, editing or reading a quote', async () => {
	const id = await create();
	const attempts = [warehouse, driver].flatMap((actor) => [
		createQuote(db, quote1043, actor),
		updateQuote(db, { ...quote1043, id }, actor),
		getQuote(db, id, actor),
		getNewQuoteValidUntil(db, actor)
	]);
	for (const attempt of attempts) {
		expect(isHttpError(await attempt.catch((caught) => caught), 403)).toBe(true);
	}
	expect(database.prepare('select count(*) as count from quotes').get()).toEqual({ count: 1 });
});
