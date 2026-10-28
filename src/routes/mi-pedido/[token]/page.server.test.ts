import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Actor, Role } from '$lib/server/actor';
import { createMemoryD1 } from '$lib/server/db/memory-d1';
import { createOrder } from '$lib/server/services/orders';
import { handle } from '../../../hooks.server';
import { load as loadLayout } from './+layout.server';
import { load } from './+page.server';

const AUDIT = "0, 'admin', 0, 'admin'";

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
	database.exec(
		`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values ('573104428890', 'Luz Marina Restrepo', '@luz', '[]', ${AUDIT});
		insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values ('Silla Tiffany dorada', 'CHAIRS_TABLES', 2500, 500, 1, ${AUDIT});
		insert into settings (key, value, created_at, created_by, updated_at, updated_by) values ('COMPANY_WHATSAPP', '573105550142', ${AUDIT})`
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

test("a draft or an event 8 days past: the employee still goes to it, the client doesn't see it", async () => {
	const draft = await create('DRAFT');
	const old = await create('COMPLETED', '2026-10-20');
	expect(await redirectOf(draft, actor('SALES'))).toBe('/pedidos/1');
	expect(await redirectOf(old, actor('SALES'))).toBe('/pedidos/2');
	await expect(open(draft)).rejects.toSatisfy(isUnavailable);
	await expect(open(old)).rejects.toSatisfy(isUnavailable);
});

test('an unknown token or an id: the same 404, with a session or without', async () => {
	await create('CONFIRMED');
	for (const token of [crypto.randomUUID(), '1']) {
		await expect(open(token, actor('SALES'))).rejects.toSatisfy(isUnavailable);
		await expect(open(token)).rejects.toSatisfy(isUnavailable);
	}
});

test('with no session, the page, writing nothing: events and sessions unchanged', async () => {
	const token = await create('CONFIRMED');
	const count = (table: string) =>
		database.prepare(`select count(*) as total from ${table}`).get()?.total;
	const before = [count('events'), count('sessions')];
	expect(await open(token)).toMatchObject({ order: { id: 1, status: 'CONFIRMED' } });
	expect([count('events'), count('sessions')]).toEqual(before);
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
