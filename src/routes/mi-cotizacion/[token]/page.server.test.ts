import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Actor } from '$lib/server/actor';
import { ADMIN, createFixture, DRIVER, MANAGER, SALES, WAREHOUSE } from '$lib/server/db/fixture';
import { createPublicToken } from '$lib/server/public-token';
import { getPublicToken } from '$lib/server/services/orders';
import {
	convertQuote,
	getQuotePublicToken,
	getSourceQuoteId,
	updateQuote
} from '$lib/server/services/quotes';
import {
	getSystemSettings,
	updateSystemSettings,
	updateTerms
} from '$lib/server/services/settings';
import { handle } from '../../../hooks.server';
import { load as loadLayout } from './+layout.server';
import { load } from './+page.server';
import { load as loadOrder } from '../../mi-pedido/[token]/+page.server';

const ORIGIN = 'https://app.example.com';

// Wednesday 14 October 2026, when the quotes are saved, and the 28th, when they're opened.
const OCTOBER_14 = new Date('2026-10-14T15:00:00Z');
const OCTOBER_28 = new Date('2026-10-28T15:00:00Z');

let db: D1Database;
let database: DatabaseSync;
let fixture: ReturnType<typeof createFixture>;
let TIFFANY: number;
let postobon: number | undefined;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(OCTOBER_28);
	onTestFinished(() => {
		vi.useRealTimers();
	});
	fixture = createFixture();
	({ db, database } = fixture);
	postobon = undefined;
	TIFFANY = await fixture.product({ name: 'Silla Tiffany dorada', rental_price: '2500' });
	const values = await getSystemSettings(db, ['COMPANY'], MANAGER);
	const form = { ...values, COMPANY_WHATSAPP: '573105550142' };
	await updateSystemSettings(db, { modules: ['COMPANY'], values: form }, MANAGER);
	await updateTerms(db, { text: '## Depósito' }, MANAGER);
});

/** Postobón, the quotes' client; `fields` over it only before its first quote. */
async function client(fields: Record<string, unknown> = {}): Promise<number> {
	postobon ??= await fixture.contact({
		full_name: 'Postobón S.A.',
		phone: '604 576 5100',
		document_id: '8909039395',
		...fields
	});
	return postobon;
}

type Seed = { validUntil?: string; transportCost?: number | null };

/** The quote as Sales types it: 200 chairs at $2.200, less $40.000. */
async function quoteInput({ validUntil = '2026-11-30', transportCost = 250000 }: Seed = {}) {
	return {
		client_id: await client(),
		client_name: 'Postobón S.A.',
		event_date: '2026-12-12',
		valid_until: validUntil,
		rental_days: 1,
		quote_items: [{ product_id: TIFFANY, qty: 200, unit_price: 2200 }],
		discount: 40000,
		transport_cost: transportCost,
		transported_by: 'COMPANY',
		address_1: 'Hacienda Fizebad',
		notes: 'Montaje desde las 7:00 a.m.'
	};
}

/** A quote saved on 14 October: its id and its client link's token. */
async function saveQuote(seed: Seed = {}): Promise<{ id: number; token: string }> {
	vi.setSystemTime(OCTOBER_14);
	const id = await fixture.quote(await quoteInput(seed));
	vi.setSystemTime(OCTOBER_28);
	return { id, token: String(await getQuotePublicToken(db, id, SALES)) };
}

type Converted = { quoteToken: string; orderId: number; orderToken: string };

// An order's quote link and the order's own: the order converted from its quote, then moved on.
async function tokensOf(orderId: number): Promise<Converted> {
	const quoteId = Number(await getSourceQuoteId(db, orderId, SALES));
	return {
		quoteToken: String(await getQuotePublicToken(db, quoteId, SALES)),
		orderId,
		orderToken: String(await getPublicToken(db, orderId, SALES))
	};
}

/** A quote converted into an order in `status`. */
async function convertedQuote(status: 'CONFIRMED' | 'DELIVERED' | 'CANCELLED' = 'CONFIRMED') {
	return tokensOf(await fixture.order({ client_id: await client(), status }));
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
	const { id, token } = await saveQuote();
	const data = await open(token);
	expect(data.quote).toEqual({
		id,
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
		transportedBy: 'COMPANY',
		quoteTotal: 650000,
		notes: 'Montaje desde las 7:00 a.m.'
	});
	expect(data.terms).toBe('<h2>Depósito</h2>\n');
	const shown = JSON.stringify(data);
	for (const hidden of ['576045765100', '8909039395', 'client_id', 'list_price', 'manager']) {
		expect(shown).not.toContain(hidden);
	}
	expect(Object.keys(data.quote)).not.toEqual(
		expect.arrayContaining(['timeline', 'createdBy', 'updatedBy', 'clientId'])
	);
});

test("the load sends neither the client's phone nor username: its keys, listed", async () => {
	await client({ whatsapp: 'PostobonEventos' });
	const { token } = await saveQuote();
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
			'transportedBy',
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
	const data = await open((await saveQuote({ transportCost: null })).token);
	expect(data.quote).toMatchObject({ transportCost: null, quoteTotal: 400000 });
});

test('«Quién transporta» reaches the client: the company, or the client who picks up', async () => {
	const { id, token } = await saveQuote();
	expect((await open(token)).quote.transportedBy).toBe('COMPANY');
	const byClient = { ...(await quoteInput()), id, transported_by: 'CLIENT' };
	expect(await updateQuote(db, byClient, SALES)).toEqual({ ok: true, id });
	expect((await open(token)).quote.transportedBy).toBe('CLIENT');
});

test('expired, unknown, or a quote id: the same 404, «ya no está disponible»', async () => {
	const expired = await saveQuote({ validUntil: '2026-10-27' });
	const valid = await saveQuote();
	const ids = [String(expired.id), String(valid.id)];
	for (const token of [expired.token, createPublicToken(), ...ids]) {
		await expect(open(token)).rejects.toSatisfy(isUnavailable);
	}
});

test('an expired quote renewed to a later «Válida hasta» opens again at the same link', async () => {
	const { id, token } = await saveQuote({ validUntil: '2026-10-27' });
	await expect(open(token)).rejects.toSatisfy(isUnavailable);
	const renewed = await quoteInput({ validUntil: '2026-11-15' });
	expect(await updateQuote(db, { ...renewed, id }, SALES)).toEqual({ ok: true, id });
	expect((await open(token)).quote.id).toBe(id);
});

test("a converted quote's link goes to its order's page, whatever the order's status or «Válida hasta»", async () => {
	for (const status of ['CONFIRMED', 'DELIVERED', 'CANCELLED'] as const) {
		const { quoteToken, orderToken } = await convertedQuote(status);
		expect(await redirectOf(quoteToken)).toBe(`/mi-pedido/${orderToken}`);
	}
	// Converted on 14 October, valid until the 15th: past its «Válida hasta» now.
	const { id, token } = await saveQuote({ validUntil: '2026-10-15' });
	vi.setSystemTime(OCTOBER_14);
	const order = {
		client_id: await client(),
		client_name: 'Postobón S.A.',
		event_date: '2026-12-12',
		delivery_date: '2026-12-11',
		pickup_date: '2026-12-13',
		rental_days: 1,
		delivery_attributes: { method: 'COMPANY_DELIVERY', time: null, address_1: 'Hacienda Fizebad' },
		pickup_attributes: { method: 'COMPANY_PICKUP', time: null, address_1: 'Hacienda Fizebad' },
		order_items: [{ product_id: TIFFANY, qty: 200, unit_price: 2200 }],
		transport_cost: 0
	};
	const converted = await convertQuote(db, { quote: id, order, force: true }, SALES);
	vi.setSystemTime(OCTOBER_28);
	if (!converted.ok) {
		throw new Error(JSON.stringify(converted));
	}
	const pastToken = await getPublicToken(db, converted.id, SALES);
	expect(await redirectOf(token)).toBe(`/mi-pedido/${pastToken}`);
});

test("WAREHOUSE and DRIVER follow a converted quote's link to the order's operational detail", async () => {
	const { quoteToken, orderId, orderToken } = await convertedQuote();
	for (const user of [WAREHOUSE, DRIVER]) {
		const location = await redirectOf(quoteToken, user);
		expect(location).toBe(`/mi-pedido/${orderToken}`);
		const event = { locals: { user }, params: { token: orderToken } };
		await expect(loadOrder({ ...event, platform: { env: { DB: db } } } as never)).rejects.toSatisfy(
			(thrown) => isRedirect(thrown) && `/despachos/${orderId}` === thrown.location
		);
	}
});

test('opening it writes nothing: events and sessions unchanged', async () => {
	const { token } = await saveQuote();
	const { quoteToken: converted } = await convertedQuote();
	const count = (table: string) =>
		database.prepare(`select count(*) as total from ${table}`).get()?.total;
	const before = [count('events'), count('sessions')];
	await open(token);
	await open(token, WAREHOUSE);
	await redirectOf(converted);
	await redirectOf(converted, DRIVER);
	expect([count('events'), count('sessions')]).toEqual(before);
});

test('SALES, MANAGER and ADMIN go to the quote, whatever its state', async () => {
	const converted = await convertedQuote();
	const quotes = [
		await saveQuote(),
		await saveQuote({ validUntil: '2026-10-27' }),
		{
			id: Number(await getSourceQuoteId(db, converted.orderId, SALES)),
			token: converted.quoteToken
		}
	];
	for (const user of [SALES, MANAGER, ADMIN]) {
		for (const { id, token } of quotes) {
			expect(await redirectOf(token, user)).toBe(`/cotizaciones/${id}`);
		}
	}
});

test("WAREHOUSE and DRIVER get the client's page; an unknown token is the same 404 for everyone", async () => {
	const valid = await saveQuote();
	const expired = await saveQuote({ validUntil: '2026-10-27' });
	for (const user of [WAREHOUSE, DRIVER]) {
		expect((await open(valid.token, user)).quote.id).toBe(valid.id);
		await expect(open(expired.token, user)).rejects.toSatisfy(isUnavailable);
	}
	const unknown = createPublicToken();
	for (const user of [null, SALES, MANAGER, ADMIN, WAREHOUSE, DRIVER]) {
		await expect(open(unknown, user)).rejects.toSatisfy(isUnavailable);
	}
});

function textOf(href: string | null): string | null {
	const url = new URL(String(href));
	expect(`${url.origin}${url.pathname}`).toBe('https://wa.me/573105550142');
	return url.searchParams.get('text');
}

test("the two buttons and the floating icon carry their messages and the page's own URL", async () => {
	const { id, token } = await saveQuote();
	const page = `${ORIGIN}/mi-cotizacion/${token}`;
	const data = await open(token);
	expect(textOf(data.confirmHref)).toBe(`Hola. Quiero confirmar la cotización #${id} ${page}`);
	expect(textOf(data.changesHref)).toBe(
		`Hola. Quiero solicitar cambios en la cotización #${id} ${page}`
	);
	expect(data.confirmHref).toContain(encodeURIComponent(`la cotización #${id} ${page}`));
	for (const path of [`/mi-cotizacion/${token}`, `/mi-cotizacion/${createPublicToken()}`]) {
		const url = new URL(`${ORIGIN}${path}`);
		const layout = await loadLayout({ platform: { env: { DB: db } }, url } as never);
		expect(textOf(layout?.whatsAppHref ?? null)).toBe(
			`Hola. Tengo una duda con mi cotización ${ORIGIN}${path}`
		);
	}
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
