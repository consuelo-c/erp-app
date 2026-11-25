import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { render } from 'svelte/server';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Actor } from '$lib/server/actor';
import { ADMIN, createFixture, DRIVER, MANAGER, SALES, WAREHOUSE } from '$lib/server/db/fixture';
import { createPublicToken } from '$lib/server/public-token';
import { getPublicToken, type OrderStatus } from '$lib/server/services/orders';
import {
	getSystemSettings,
	updateSystemSettings,
	updateTerms
} from '$lib/server/services/settings';
import { handle } from '../../../hooks.server';
import { load as loadLayout } from './+layout.server';
import { load } from './+page.server';
import Page from './+page.svelte';

let db: D1Database;
let database: DatabaseSync;
let fixture: ReturnType<typeof createFixture>;
let TIFFANY: number;

beforeEach(async () => {
	// Wednesday 28 October 2026 in Bogotá.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-28T15:00:00Z'));
	onTestFinished(() => {
		vi.useRealTimers();
	});
	fixture = createFixture();
	({ db, database } = fixture);
	TIFFANY = await fixture.product({ name: 'Silla Tiffany dorada', rental_price: '2500' });
	const values = await getSystemSettings(db, ['COMPANY'], MANAGER);
	const form = { ...values, COMPANY_WHATSAPP: '573105550142' };
	await updateSystemSettings(db, { modules: ['COMPANY'], values: form }, MANAGER);
});

type Seed = {
	status?: OrderStatus;
	eventDate?: string;
	depositAmount?: number;
	/** The client's WhatsApp username, frozen into the order. */
	whatsapp?: string;
};

/**
 * Luz Marina's order of 10 chairs ($25.000) in `status`, its event on `eventDate`: its id, and
 * its client link's token.
 */
async function create({
	status = 'CONFIRMED',
	eventDate = '2026-10-31',
	depositAmount = 0,
	whatsapp
}: Seed = {}): Promise<{ id: number; token: string }> {
	const client = await fixture.contact({
		full_name: 'Luz Marina Restrepo',
		phone: '310 442 8890',
		...(undefined === whatsapp ? {} : { whatsapp })
	});
	const trip = { time: '14:00', address_1: 'Cra 43A #18-95', address_2: null };
	const id = await fixture.order({
		status,
		client_id: client,
		event_date: eventDate,
		delivery_date: eventDate,
		pickup_date: eventDate,
		rental_days: 1,
		delivery_attributes: { ...trip, method: 'COMPANY_DELIVERY' },
		pickup_attributes: { ...trip, method: 'COMPANY_PICKUP' },
		order_items: [{ product_id: TIFFANY, qty: 10, unit_price: 2500 }],
		deposit_amount: depositAmount
	});
	return { id, token: String(await getPublicToken(db, id, SALES)) };
}

function open(token: string, user: Actor | null = null) {
	const event = { locals: { user }, params: { token }, platform: { env: { DB: db } } };
	return load(event as never);
}

async function redirectOf(token: string, user: Actor): Promise<string> {
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
	isHttpError(thrown, 404) && 'Este pedido ya no está disponible' === thrown.body.message;

test('an employee goes to the order in the dashboard: sales to Pedidos, the rest to Despachos', async () => {
	const { id, token } = await create();
	for (const user of [SALES, MANAGER, ADMIN]) {
		expect(await redirectOf(token, user)).toBe(`/pedidos/${id}`);
	}
	for (const user of [WAREHOUSE, DRIVER]) {
		expect(await redirectOf(token, user)).toBe(`/despachos/${id}`);
	}
});

test("an event 31 days past: the employee still goes to it, the client doesn't see it", async () => {
	const old = await create({ status: 'COMPLETED', eventDate: '2026-09-27' });
	expect(await redirectOf(old.token, SALES)).toBe(`/pedidos/${old.id}`);
	await expect(open(old.token)).rejects.toSatisfy(isUnavailable);
});

test('an unknown token or an id: the same 404, with a session or without', async () => {
	const { id } = await create();
	for (const token of [createPublicToken(), String(id)]) {
		await expect(open(token, SALES)).rejects.toSatisfy(isUnavailable);
		await expect(open(token)).rejects.toSatisfy(isUnavailable);
	}
});

test("the load sends neither the client's phone nor username: its keys, listed", async () => {
	const { token } = await create({ whatsapp: 'LuzMarina10' });
	const data = (await open(token)) as { order: object; terms: string };
	expect(Object.keys(data)).toEqual(['order', 'terms']);
	expect(Object.keys(data.order).sort()).toEqual(
		[
			'id',
			'status',
			'clientName',
			'eventDate',
			'rentalDays',
			'delivery',
			'pickup',
			'items',
			'itemsTotal',
			'discount',
			'transportCost',
			'orderTotal',
			'depositAmount',
			'depositHeld',
			'paid',
			'balanceDue',
			'damageCharged',
			'owedToClient',
			'receivableId',
			'receivableBalance'
		].sort()
	);
	const shown = JSON.stringify(data).toLowerCase();
	for (const hidden of ['3104428890', 'luzmarina10', 'whatsapp', 'phone']) {
		expect(shown).not.toContain(hidden);
	}
});

/** A movement's concept, and its refund's for a negative amount. */
type MovementKind = { concept: string; refundConcept: string };
const DEPOSIT: MovementKind = { concept: 'SECURITY_DEPOSIT', refundConcept: 'DEPOSIT_REFUND' };
const INSTALLMENT: MovementKind = { concept: 'INSTALLMENT', refundConcept: 'INSTALLMENT_REFUND' };

/** A movement on the order through its payment entry, its refund when `amount` is negative. */
async function pay(orderId: number, { concept, refundConcept }: MovementKind, amount: number) {
	await fixture.payment(orderId, {
		concept: amount > 0 ? concept : refundConcept,
		amount: String(Math.abs(amount))
	});
}

/**
 * «Su pedido» as the client reads it: the order agreeing `depositAmount`, with these deposit and
 * installment movements (a negative one is its refund).
 */
async function pageWith(
	status: string,
	depositAmount: number,
	{ deposits = [], installments = [] }: { deposits?: number[]; installments?: number[] } = {}
) {
	const { id, token } = await create({ status: status as OrderStatus, depositAmount });
	for (const amount of deposits) {
		await pay(id, DEPOSIT, amount);
	}
	for (const amount of installments) {
		await pay(id, INSTALLMENT, amount);
	}
	return render(Page, { props: { data: await open(token) } as never }).body;
}

test('«Depósito» reads «$20.000 de $50.000», received of agreed, right after «Total»', async () => {
	expect(await pageWith('CONFIRMED', 50000, { deposits: [20000] })).toMatch(
		/<span>Total<\/span><span>\$25\.000<\/span><\/li>\s*<!--\[0--><li class="detail-list__row--plain"><span>Depósito<\/span><span>\$20\.000 de \$50\.000<\/span><\/li>/
	);
});

test('received is net of «Devolución de depósito»', async () => {
	const body = await pageWith('CONFIRMED', 50000, { deposits: [50000, -30000] });
	expect(body).toContain('<span>Depósito</span><span>$20.000 de $50.000</span>');
});

test.each([
	['CONFIRMED', 0, []],
	['COMPLETED', 50000, [50000, -50000]],
	['CANCELLED', 50000, [50000]]
])('no deposit line on a %s order agreeing %i', async (status, depositAmount, deposits) => {
	const body = await pageWith(status, depositAmount, { deposits });
	expect(body).toContain('<span>Total</span>');
	expect(body).not.toContain('<span>Depósito</span>');
});

test('a CANCELLED order with nothing paid reads «Saldo a su favor $0», never its total as «Saldo»', async () => {
	const body = await pageWith('CANCELLED', 0);
	expect(body).toContain('<span>Pagado</span><span>$0</span>');
	expect(body).toMatch(
		/<li class="detail-list__row--strong"><span>Saldo a su favor<\/span><span class="credit[^"]*">\$0<\/span>/
	);
	expect(body).not.toContain('<span>Saldo</span>');
});

test('a CANCELLED order reads what the company holds: installments net of refunds, plus the deposit held', async () => {
	const body = await pageWith('CANCELLED', 50000, {
		deposits: [50000],
		installments: [20000, -10000]
	});
	expect(body).toContain('<span>Pagado</span><span>$10.000</span>');
	expect(body).toMatch(/<span>Saldo a su favor<\/span><span class="credit[^"]*">\$60\.000<\/span>/);
	expect(body).not.toContain('<span>Saldo</span>');
});

test('a CANCELLED order paid above its total has no «más del total» note', async () => {
	const body = await pageWith('CANCELLED', 0, { installments: [30000] });
	expect(body).toMatch(/<span>Saldo a su favor<\/span><span class="credit[^"]*">\$30\.000<\/span>/);
	expect(body).not.toContain('más del total');
});

test("an order that isn't CANCELLED still reads «Saldo»", async () => {
	expect(await pageWith('CONFIRMED', 0, { installments: [10000] })).toContain(
		'<span>Saldo</span><span>$15.000</span>'
	);
});

test("an order that isn't CANCELLED, paid above its total, reads the overpayment", async () => {
	const overpaid = await pageWith('CONFIRMED', 0, { installments: [30000] });
	expect(overpaid).toMatch(
		/<span>Saldo a su favor<\/span><span class="credit[^"]*">\$5\.000<\/span>/
	);
	expect(overpaid).toContain('Pagó $5.000 más del total del pedido.');
});

test('with no session, the page, writing nothing: events and sessions unchanged', async () => {
	const { id, token } = await create();
	const count = (table: string) =>
		database.prepare(`select count(*) as total from ${table}`).get()?.total;
	const before = [count('events'), count('sessions')];
	expect(await open(token)).toMatchObject({ order: { id, status: 'CONFIRMED' } });
	expect([count('events'), count('sessions')]).toEqual(before);
});

test("the terms under the order: rendered by renderTerms' rules, empty while there are none", async () => {
	const { token } = await create();
	expect(await open(token)).toMatchObject({ terms: '' });
	const text = '## Depósito\n\nSe devuelve **al recoger**. <script>alert(1)</script>';
	expect(await updateTerms(db, { text }, MANAGER)).toEqual({ ok: true });
	expect(await open(token)).toMatchObject({
		terms:
			'<h2>Depósito</h2>\n<p>Se devuelve <strong>al recoger</strong>. &lt;script&gt;alert(1)&lt;/script&gt;</p>\n'
	});
});

test("the WhatsApp message carries the page's own URL, from the request's origin", async () => {
	const { token } = await create();
	for (const path of [`/mi-pedido/${token}`, `/mi-pedido/${createPublicToken()}`]) {
		const url = new URL(`https://pedidos.example.com${path}`);
		const data = await loadLayout({ platform: { env: { DB: db } }, url } as never);
		const href = new URL(String(data?.whatsAppHref));
		expect(`${href.origin}${href.pathname}`).toBe('https://wa.me/573105550142');
		expect(href.searchParams.get('text')).toBe(
			`Hola. Tengo una duda con mi pedido https://pedidos.example.com${path}`
		);
	}
});

test('the client page never leaks its token, is never indexed and never kept', async () => {
	const respond = async (routeId: string) => {
		const event = { cookies: { get: () => undefined }, locals: {}, route: { id: routeId } };
		return handle({ event: event as never, resolve: async () => new Response('') });
	};
	const headers = Object.fromEntries((await respond('/mi-pedido/[token]')).headers);
	expect(headers).toMatchObject({
		'referrer-policy': 'no-referrer',
		'x-robots-tag': 'noindex',
		'cache-control': 'private, no-store'
	});
	expect((await respond('/login')).headers.get('x-robots-tag')).toBeNull();
});
