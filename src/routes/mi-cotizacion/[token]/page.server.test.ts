import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Actor, Role } from '$lib/server/actor';
import { createMemoryD1 } from '$lib/server/db/memory-d1';
import { handle } from '../../../hooks.server';
import { load as loadLayout } from './+layout.server';
import { load } from './+page.server';
import { load as loadOrder } from '../../mi-pedido/[token]/+page.server';

const AUDIT = "0, 'admin', 0, 'admin'";
const ORIGIN = 'https://app.example.com';

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
	database.exec(
		`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values ('576045765100', 'Postobón S.A.', '8909039395', '[]', ${AUDIT});
		insert into settings (key, value, created_at, created_by, updated_at, updated_by) values ('COMPANY_WHATSAPP', '573105550142', ${AUDIT}), ('TERMS_CONDITIONS', '## Depósito', ${AUDIT})`
	);
	// Wednesday 28 October 2026 in Bogotá.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-28T15:00:00Z'));
	onTestFinished(() => {
		vi.useRealTimers();
	});
});

function actor(role: Role): Actor {
	return { username: role.toLowerCase(), employeeId: null, roles: [role], kind: 'user' };
}

type QuoteRow = {
	validUntil?: string;
	orderId?: number;
	orderStatus?: 'CONFIRMED' | 'DELIVERED' | 'CANCELLED';
	transportCost?: number | null;
};

/** The client link token of the order each converted quote is inserted with, by order id. */
const orderTokens = new Map<number, string>();

const ITEMS = [
	{
		product_id: 1,
		name: 'Silla Tiffany dorada',
		qty: 200,
		list_price: 2500,
		unit_price: 2200,
		line_total: 440000
	}
];

/** A quote straight into the table, and its client link's token. */
function insertQuote({
	validUntil = '2026-11-30',
	orderId,
	orderStatus = 'CONFIRMED',
	transportCost = 250000
}: QuoteRow = {}) {
	const token = crypto.randomUUID();
	const total = 440000 - 40000 + (transportCost ?? 0);
	if (undefined !== orderId) {
		orderTokens.set(orderId, crypto.randomUUID());
		database.exec(
			`insert into orders (id, public_token, client_id, status, event_date, delivery_date, pickup_date, rental_days, client_attributes, delivery_attributes, pickup_attributes, order_items, items_total, order_total, created_at, created_by, updated_at, updated_by)
			values (${orderId}, '${orderTokens.get(orderId)}', 1, '${orderStatus}', '2026-12-12', '2026-12-11', '2026-12-13', 1, '{}', '{"method":"COMPANY_DELIVERY"}', '{"method":"COMPANY_PICKUP"}', '[]', 0, 0, ${AUDIT})`
		);
	}
	database
		.prepare(
			`insert into quotes (public_token, client_id, order_id, event_date, valid_until, rental_days, client_attributes, quote_items, items_total, discount, transport_cost, quote_total, attributes, created_at, created_by, updated_at, updated_by)
			values (?, 1, ?, '2026-12-12', ?, 1, '{"name":"Postobón S.A.","phone":"576045765100","whatsapp":null}', ?, 440000, 40000, ?, ?, '{"address_1":"Hacienda Fizebad","notes":"Montaje desde las 7:00 a.m."}', unixepoch('2026-10-14 15:00:00'), 'ventas', 0, 'ventas')`
		)
		.run(token, orderId ?? null, validUntil, JSON.stringify(ITEMS), transportCost, total);
	return token;
}

type PageData = Exclude<Awaited<ReturnType<typeof load>>, void>;

async function open(token: string, user: Actor | null = null): Promise<PageData> {
	const url = new URL(`${ORIGIN}/mi-cotizacion/${token}`);
	const event = { locals: { user }, params: { token }, platform: { env: { DB: db } }, url };
	return (await load(event as never)) as PageData;
}

async function redirectOf(token: string, user: Actor | null = null): Promise<string> {
	try {
		await open(token, user);
	} catch (thrown) {
		if (isRedirect(thrown) && 303 === thrown.status) {
			return thrown.location;
		}
		throw thrown;
	}
	throw new Error('No redirect');
}

const isUnavailable = (thrown: unknown) =>
	isHttpError(thrown, 404) && 'Esta cotización ya no está disponible' === thrown.body.message;

test('a valid quote shows, with no session, built for the client: no phone, document or list price', async () => {
	const token = insertQuote();
	const data = await open(token);
	expect(data.quote).toEqual({
		id: 1,
		createdOn: '2026-10-14',
		validUntil: '2026-11-30',
		clientName: 'Postobón S.A.',
		eventDate: '2026-12-12',
		address1: 'Hacienda Fizebad',
		address2: null,
		rentalDays: 1,
		items: [{ name: 'Silla Tiffany dorada', qty: 200, unit_price: 2200, line_total: 440000 }],
		itemsTotal: 440000,
		discount: 40000,
		transportCost: 250000,
		quoteTotal: 650000,
		notes: 'Montaje desde las 7:00 a.m.'
	});
	expect(data.terms).toBe('<h2>Depósito</h2>\n');
	const shown = JSON.stringify(data);
	for (const hidden of ['576045765100', '8909039395', 'client_id', 'list_price', 'ventas']) {
		expect(shown).not.toContain(hidden);
	}
	expect(Object.keys(data.quote)).not.toEqual(
		expect.arrayContaining(['timeline', 'createdBy', 'updatedBy', 'clientId'])
	);
});

test("the load sends neither the client's phone nor username: its keys, listed", async () => {
	const token = insertQuote();
	database.exec(
		`update quotes set client_attributes = json_set(client_attributes, '$.whatsapp', 'PostobonEventos');
		update contacts set whatsapp = 'PostobonEventos'`
	);
	const data = await open(token);
	expect(Object.keys(data).sort()).toEqual(['changesHref', 'confirmHref', 'quote', 'terms']);
	expect(Object.keys(data.quote).sort()).toEqual(
		[
			'id',
			'createdOn',
			'validUntil',
			'clientName',
			'eventDate',
			'address1',
			'address2',
			'rentalDays',
			'items',
			'itemsTotal',
			'discount',
			'transportCost',
			'quoteTotal',
			'notes'
		].sort()
	);
	const shown = JSON.stringify(data.quote).toLowerCase();
	for (const hidden of ['576045765100', 'postoboneventos', 'whatsapp', 'phone']) {
		expect(shown).not.toContain(hidden);
	}
});

test('«por acordar» transport: no price, and the total leaves it out', async () => {
	const data = await open(insertQuote({ transportCost: null }));
	expect(data.quote).toMatchObject({ transportCost: null, quoteTotal: 400000 });
});

test('expired, unknown, or a quote id: the same 404, «ya no está disponible»', async () => {
	const expired = insertQuote({ validUntil: '2026-10-27' });
	for (const token of [expired, crypto.randomUUID(), '12', '1']) {
		await expect(open(token)).rejects.toSatisfy(isUnavailable);
	}
});

test('an expired quote renewed to a later «Válida hasta» opens again at the same link', async () => {
	const token = insertQuote({ validUntil: '2026-10-27' });
	await expect(open(token)).rejects.toSatisfy(isUnavailable);
	database.exec("update quotes set valid_until = '2026-11-15'");
	expect((await open(token)).quote.id).toBe(1);
});

test("a converted quote's link goes to its order's page, whatever the order's status or «Válida hasta»", async () => {
	const statuses = ['CONFIRMED', 'DELIVERED', 'CANCELLED'] as const;
	for (const [index, orderStatus] of statuses.entries()) {
		const orderId = 1060 + index;
		const token = insertQuote({ orderId, orderStatus });
		expect(await redirectOf(token)).toBe(`/mi-pedido/${orderTokens.get(orderId)}`);
	}
	const past = insertQuote({ orderId: 1070, validUntil: '2026-10-01' });
	expect(await redirectOf(past)).toBe(`/mi-pedido/${orderTokens.get(1070)}`);
});

test("WAREHOUSE and DRIVER follow a converted quote's link to the order's operational detail", async () => {
	const token = insertQuote({ orderId: 1060 });
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const location = await redirectOf(token, actor(role));
		const orderToken = String(orderTokens.get(1060));
		expect(location).toBe(`/mi-pedido/${orderToken}`);
		const event = { locals: { user: actor(role) }, params: { token: orderToken } };
		await expect(loadOrder({ ...event, platform: { env: { DB: db } } } as never)).rejects.toSatisfy(
			(thrown) => isRedirect(thrown) && '/despachos/1060' === thrown.location
		);
	}
});

test('opening it writes nothing: events and sessions unchanged', async () => {
	const token = insertQuote();
	const converted = insertQuote({ orderId: 1060 });
	const count = (table: string) =>
		database.prepare(`select count(*) as total from ${table}`).get()?.total;
	const before = [count('events'), count('sessions')];
	await open(token);
	await open(token, actor('WAREHOUSE'));
	await redirectOf(converted);
	await redirectOf(converted, actor('DRIVER'));
	expect([count('events'), count('sessions')]).toEqual(before);
});

test('SALES, MANAGER and ADMIN go to the quote, whatever its state', async () => {
	const tokens = [
		insertQuote(),
		insertQuote({ validUntil: '2026-10-27' }),
		insertQuote({ orderId: 1060 })
	];
	for (const role of ['SALES', 'MANAGER', 'ADMIN'] satisfies Role[]) {
		for (const [index, token] of tokens.entries()) {
			expect(await redirectOf(token, actor(role))).toBe(`/cotizaciones/${index + 1}`);
		}
	}
});

test("WAREHOUSE and DRIVER get the client's page; an unknown token is the same 404 for everyone", async () => {
	const valid = insertQuote();
	const expired = insertQuote({ validUntil: '2026-10-27' });
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		expect((await open(valid, actor(role))).quote.id).toBe(1);
		await expect(open(expired, actor(role))).rejects.toSatisfy(isUnavailable);
	}
	const unknown = crypto.randomUUID();
	for (const user of [null, ...(['SALES', 'MANAGER', 'ADMIN', 'WAREHOUSE', 'DRIVER'] as const)]) {
		await expect(open(unknown, null === user ? null : actor(user))).rejects.toSatisfy(
			isUnavailable
		);
	}
});

function textOf(href: string | null): string | null {
	const url = new URL(String(href));
	expect(`${url.origin}${url.pathname}`).toBe('https://wa.me/573105550142');
	return url.searchParams.get('text');
}

test("the two buttons and the floating icon carry their messages and the page's own URL", async () => {
	const token = insertQuote();
	const page = `${ORIGIN}/mi-cotizacion/${token}`;
	const data = await open(token);
	expect(textOf(data.confirmHref)).toBe(`Hola. Quiero confirmar la cotización #1 ${page}`);
	expect(textOf(data.changesHref)).toBe(
		`Hola. Quiero solicitar cambios en la cotización #1 ${page}`
	);
	expect(data.confirmHref).toContain(encodeURIComponent(`la cotización #1 ${page}`));
	for (const path of [`/mi-cotizacion/${token}`, `/mi-cotizacion/${crypto.randomUUID()}`]) {
		const url = new URL(`${ORIGIN}${path}`);
		const layout = await loadLayout({ platform: { env: { DB: db } }, url } as never);
		expect(textOf(layout?.whatsAppHref ?? null)).toBe(
			`Hola. Tengo una duda con mi cotización ${ORIGIN}${path}`
		);
	}
});

test('with COMPANY_WHATSAPP empty, no button and no icon', async () => {
	const token = insertQuote();
	database.exec("update settings set value = '' where key = 'COMPANY_WHATSAPP'");
	expect(await open(token)).toMatchObject({ confirmHref: null, changesHref: null });
	const url = new URL(`${ORIGIN}/mi-cotizacion/${token}`);
	expect(await loadLayout({ platform: { env: { DB: db } }, url } as never)).toEqual({
		whatsAppHref: null
	});
});

test('the quote page never leaks its token, is never indexed and never kept', async () => {
	const event = {
		cookies: { get: () => undefined },
		locals: {},
		route: { id: '/mi-cotizacion/[token]' }
	};
	const response = await handle({ event: event as never, resolve: async () => new Response('') });
	expect(Object.fromEntries(response.headers)).toMatchObject({
		'referrer-policy': 'no-referrer',
		'x-robots-tag': 'noindex',
		'cache-control': 'private, no-store'
	});
});
