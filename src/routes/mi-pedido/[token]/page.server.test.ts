import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { render } from 'svelte/server';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Actor, Role } from '$lib/server/actor';
import { createMemoryD1 } from '$lib/server/db/memory-d1';
import { createOrder } from '$lib/server/db/test-orders';
import { handle } from '../../../hooks.server';
import { load as loadLayout } from './+layout.server';
import { load } from './+page.server';
import Page from './+page.svelte';

const AUDIT = "0, 'admin', 0, 'admin'";

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
	database.exec(
		`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values ('573104428890', 'Luz Marina Restrepo', '@luz', '[]', ${AUDIT});
		insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values ('Silla Tiffany dorada', 'CHAIRS_TABLES', 2500, 500, 1, ${AUDIT});
		insert into settings (key, value, created_at, created_by, updated_at, updated_by) values ('COMPANY_WHATSAPP', '573105550142', ${AUDIT}), ('TERMS_CONDITIONS', '', ${AUDIT})`
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

/** An order in `status` with its event on `eventDate`, and its client link's token. */
async function create(status: string, eventDate = '2026-10-31'): Promise<string> {
	const trip = { time: '14:00', address_1: 'Cra 43A #18-95', address_2: null };
	const result = await createOrder(
		db,
		{
			client_id: 1,
			client_name: 'Luz Marina Restrepo',
			event_date: eventDate,
			delivery_date: eventDate,
			pickup_date: eventDate,
			rental_days: 1,
			delivery_attributes: { ...trip, method: 'COMPANY_DELIVERY' },
			pickup_attributes: { ...trip, method: 'COMPANY_PICKUP' },
			order_items: [{ product_id: 1, qty: 10, unit_price: 2500 }]
		},
		actor('SALES')
	);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	database.prepare('update orders set status = ? where id = ?').run(status, result.id);
	return String(
		database.prepare('select public_token from orders where id = ?').get(result.id)?.public_token
	);
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
	const token = await create('CONFIRMED');
	for (const role of ['SALES', 'MANAGER', 'ADMIN'] satisfies Role[]) {
		expect(await redirectOf(token, actor(role))).toBe('/pedidos/1');
	}
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		expect(await redirectOf(token, actor(role))).toBe('/despachos/1');
	}
});

test("an event 31 days past: the employee still goes to it, the client doesn't see it", async () => {
	const old = await create('COMPLETED', '2026-09-27');
	expect(await redirectOf(old, actor('SALES'))).toBe('/pedidos/1');
	await expect(open(old)).rejects.toSatisfy(isUnavailable);
});

test('an unknown token or an id: the same 404, with a session or without', async () => {
	await create('CONFIRMED');
	for (const token of [crypto.randomUUID(), '1']) {
		await expect(open(token, actor('SALES'))).rejects.toSatisfy(isUnavailable);
		await expect(open(token)).rejects.toSatisfy(isUnavailable);
	}
});

test("the load sends neither the client's phone nor username: its keys, listed", async () => {
	database.exec("update contacts set whatsapp = 'LuzMarina10' where id = 1");
	const token = await create('CONFIRMED');
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
			'receivableId',
			'receivableBalance'
		].sort()
	);
	const shown = JSON.stringify(data).toLowerCase();
	for (const hidden of ['3104428890', 'luzmarina10', 'whatsapp', 'phone']) {
		expect(shown).not.toContain(hidden);
	}
});

/** «Su pedido» as the client reads it: the order agreeing `depositAmount`, with these deposit movements. */
async function pageWith(status: string, depositAmount: number, deposits: number[]) {
	const token = await create(status);
	database.prepare('update orders set deposit_amount = ? where id = 1').run(depositAmount);
	for (const amount of deposits) {
		database.exec(
			`insert into cash_movements (concept, payment_method, amount, movement_date, entity_type, entity_id, payee, receipt_number, created_at, created_by, updated_at, updated_by)
			values ('${amount > 0 ? 'SECURITY_DEPOSIT' : 'DEPOSIT_REFUND'}', 'CASH', ${amount}, '2026-10-20', 'ORDER', 1, 'Luz Marina Restrepo', (select coalesce(max(receipt_number), 0) + 1 from cash_movements), ${AUDIT})`
		);
	}
	return render(Page, { props: { data: await open(token) } as never }).body;
}

test('«Depósito» reads «$20.000 de $50.000», received of agreed, right after «Total»', async () => {
	expect(await pageWith('CONFIRMED', 50000, [20000])).toMatch(
		/<span>Total<\/span><span>\$25\.000<\/span><\/li>\s*<!--\[0--><li class="detail-list__row--plain"><span>Depósito<\/span><span>\$20\.000 de \$50\.000<\/span><\/li>/
	);
});

test('received is net of «Devolución de depósito»', async () => {
	const body = await pageWith('CONFIRMED', 50000, [50000, -30000]);
	expect(body).toContain('<span>Depósito</span><span>$20.000 de $50.000</span>');
});

test.each([
	['CONFIRMED', 0, []],
	['COMPLETED', 50000, [50000, -50000]],
	['CANCELLED', 50000, [50000]]
])('no deposit line on a %s order agreeing %i', async (status, depositAmount, deposits) => {
	const body = await pageWith(status, depositAmount, deposits);
	expect(body).toContain('<span>Total</span>');
	expect(body).not.toContain('<span>Depósito</span>');
});

test('with no session, the page, writing nothing: events and sessions unchanged', async () => {
	const token = await create('CONFIRMED');
	const count = (table: string) =>
		database.prepare(`select count(*) as total from ${table}`).get()?.total;
	const before = [count('events'), count('sessions')];
	expect(await open(token)).toMatchObject({ order: { id: 1, status: 'CONFIRMED' } });
	expect([count('events'), count('sessions')]).toEqual(before);
});

test("the terms under the order: rendered by renderTerms' rules, empty while there are none", async () => {
	const token = await create('CONFIRMED');
	expect(await open(token)).toMatchObject({ terms: '' });
	database
		.prepare("update settings set value = ? where key = 'TERMS_CONDITIONS'")
		.run('## Depósito\n\nSe devuelve **al recoger**. <script>alert(1)</script>');
	expect(await open(token)).toMatchObject({
		terms:
			'<h2>Depósito</h2>\n<p>Se devuelve <strong>al recoger</strong>. &lt;script&gt;alert(1)&lt;/script&gt;</p>\n'
	});
});

test("the WhatsApp message carries the page's own URL, from the request's origin", async () => {
	const token = await create('CONFIRMED');
	for (const path of [`/mi-pedido/${token}`, `/mi-pedido/${crypto.randomUUID()}`]) {
		const url = new URL(`https://pedidos.example.com${path}`);
		const data = await loadLayout({ platform: { env: { DB: db } }, url } as never);
		const href = new URL(String(data?.whatsAppHref));
		expect(`${href.origin}${href.pathname}`).toBe('https://wa.me/573105550142');
		expect(href.searchParams.get('text')).toBe(
			`Hola. Tengo una duda con mi pedido https://pedidos.example.com${path}`
		);
	}
	database.prepare("update settings set value = '' where key = 'COMPANY_WHATSAPP'").run();
	const url = new URL(`https://pedidos.example.com/mi-pedido/${token}`);
	expect(await loadLayout({ platform: { env: { DB: db } }, url } as never)).toEqual({
		whatsAppHref: null
	});
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
