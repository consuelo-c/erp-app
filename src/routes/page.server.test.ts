import { isActionFailure, isRedirect } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Actor } from '$lib/server/actor';
import { createMemoryD1 } from '$lib/server/db/memory-d1';
import { createOrder } from '$lib/server/services/orders';
import { SITEVERIFY_URL } from '$lib/server/turnstile';
import { actions, load } from './+page.server';
import { load as loadClientPage } from './mi-pedido/[token]/+page.server';

const AUDIT = "0, 'admin', 0, 'admin'";
const IP = '203.0.113.7';
const SECRET = '1x0000000000000000000000000000000AA';

const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };

let db: D1Database;
let database: DatabaseSync;
let limit: ReturnType<typeof vi.fn>;
let siteverify: ReturnType<typeof vi.fn>;

beforeEach(() => {
	({ db, database } = createMemoryD1());
	database.exec(
		`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values ('573104428890', 'Luz Marina Restrepo', '@luz', '[]', ${AUDIT});
		insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values ('Silla Tiffany dorada', 'CHAIRS_TABLES', 2500, 500, 1, ${AUDIT});
		insert into settings (key, value, created_at, created_by, updated_at, updated_by) values ('COMPANY_WHATSAPP', '573105550142', ${AUDIT})`
	);
	limit = vi.fn(async () => ({ success: true }));
	siteverify = vi.fn(async () => Response.json({ success: true }));
	vi.stubGlobal('fetch', siteverify);
	// Wednesday 28 October 2026 in Bogotá.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-28T15:00:00Z'));
	onTestFinished(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});
});

const platform = () => ({
	env: { DB: db, LOOKUP_RATE_LIMIT: { limit }, TURNSTILE_SECRET_KEY: SECRET }
});

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
		sales
	);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	database.prepare('update orders set status = ? where id = ?').run(status, result.id);
	const row = database.prepare('select public_token from orders where id = ?').get(result.id);
	return String(row?.public_token);
}

async function submit(fields: Record<string, string>) {
	const body = new URLSearchParams({ 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN', ...fields });
	const request = new Request('https://app.example.com/', {
		method: 'POST',
		body,
		headers: { 'CF-Connecting-IP': IP }
	});
	const event = { request, platform: platform(), getClientAddress: () => '10.0.0.1' };
	return actions.default(event as never);
}

const lookup = (phone: string, eventDate: string) => submit({ phone, event_date: eventDate });

test('over the limit: a 429, and neither siteverify nor D1 is called', async () => {
	limit.mockResolvedValueOnce({ success: false });
	const prepare = vi.spyOn(db, 'prepare');
	const result = await lookup('3104428890', '2026-10-31');
	expect(isActionFailure(result) && result).toMatchObject({
		status: 429,
		data: { message: 'Demasiados intentos. Espere un minuto e intente de nuevo.' }
	});
	expect(limit).toHaveBeenCalledWith({ key: IP });
	expect(siteverify).not.toHaveBeenCalled();
	expect(prepare).not.toHaveBeenCalled();
});

test('siteverify gets the secret, the token and the IP, by POST', async () => {
	await create('CONFIRMED');
	await lookup('3104428890', '2026-10-31').catch(() => {});
	const [url, init] = siteverify.mock.calls[0];
	expect(url).toBe(SITEVERIFY_URL);
	expect(init.method).toBe('POST');
	expect(Object.fromEntries(init.body)).toEqual({
		secret: SECRET,
		response: 'XXXX.DUMMY.TOKEN',
		remoteip: IP
	});
});

test('a missing token, a refusal or no answer: rejected, and no query', async () => {
	const prepare = vi.spyOn(db, 'prepare');
	const rejected = {
		status: 400,
		data: { message: 'No pudimos verificar la consulta. Intente de nuevo.' }
	};
	const missing = await submit({
		phone: '3104428890',
		event_date: '2026-10-31',
		'cf-turnstile-response': ''
	});
	expect(missing).toMatchObject(rejected);
	expect(siteverify).not.toHaveBeenCalled();
	siteverify.mockResolvedValueOnce(Response.json({ success: false }));
	expect(await lookup('3104428890', '2026-10-31')).toMatchObject(rejected);
	siteverify.mockRejectedValueOnce(new Error('timeout'));
	expect(await lookup('3104428890', '2026-10-31')).toMatchObject(rejected);
	expect(prepare).not.toHaveBeenCalled();
});

test('a phone the helper rejects is a field error', async () => {
	expect(await lookup('310 44', '2026-10-31')).toMatchObject({
		status: 400,
		data: { errors: { phone: 'Escriba el teléfono con el que hizo el pedido' }, phone: '310 44' }
	});
});

test('one match opens its page; two or more list, by id', async () => {
	const token = await create('CONFIRMED');
	await expect(lookup('310 442 8890', '2026-10-31')).rejects.toSatisfy(
		(thrown) =>
			isRedirect(thrown) && 303 === thrown.status && `/mi-pedido/${token}` === thrown.location
	);
	const extension = await create('DELIVERED');
	expect(await lookup('310 442 8890', '2026-10-31')).toMatchObject({
		matches: [
			{ id: 1, status: 'CONFIRMED', token },
			{ id: 2, status: 'DELIVERED', token: extension }
		]
	});
});

test('every miss is the same answer: wrong phone, wrong date, a draft, an event too old', async () => {
	await create('CONFIRMED');
	await create('DRAFT', '2026-11-07');
	await create('COMPLETED', '2026-10-20');
	const misses = await Promise.all([
		lookup('310 442 8891', '2026-10-31'),
		lookup('310 442 8890', '2026-11-01'),
		lookup('310 442 8890', '2026-11-07'),
		lookup('310 442 8890', '2026-10-20')
	]);
	for (const miss of misses) {
		expect(miss).toMatchObject({
			status: 404,
			data: { message: 'No encontramos un pedido con ese teléfono y esa fecha.' }
		});
	}
});

test('a lookup and a page write nothing: events and sessions unchanged', async () => {
	const token = await create('CONFIRMED');
	const count = (table: string) =>
		database.prepare(`select count(*) as total from ${table}`).get()?.total;
	const before = [count('events'), count('sessions')];
	await lookup('310 442 8890', '2026-10-31').catch(() => {});
	const event = { locals: { user: null }, params: { token }, platform: platform() };
	await loadClientPage(event as never);
	expect([count('events'), count('sessions')]).toEqual(before);
});

test("the landing's date starts 7 days back, and its WhatsApp carries no order", async () => {
	const data = await load({ platform: platform() } as never);
	expect(data?.minDate).toBe('2026-10-21');
	const href = new URL(String(data?.whatsAppHref));
	expect(href.searchParams.get('text')).toBe('Hola. Tengo una duda con mi pedido.');
});
