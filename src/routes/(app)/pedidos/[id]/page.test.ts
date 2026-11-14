import { isRedirect } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Actor } from '$lib/server/actor';
import { createMemoryD1 } from '$lib/server/db/memory-d1';
import { createOrder } from '$lib/server/db/test-orders';
import { createQuote } from '$lib/server/services/quotes';
import { actions as convertActions } from '../nuevo/+page.server';
import { actions as editActions } from './editar/+page.server';
import { actions as extensionActions } from './extension/+page.server';
import { load } from './+page.server';
import Page from './+page.svelte';

// The detail reads its notices from the URL the form's redirect leaves.
const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/pedidos/1') } }));
vi.mock('$app/state', () => state);

const AUDIT = "0, 'admin', 0, 'admin'";
const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };
const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: null };

const GREEN = 'Pedido guardado con éxito';
const BLUE =
	'El transporte, el depósito y el total son lo que se le cobra al cliente, no pagos recibidos. Registra con «Registrar pago» el pago del pedido y, aparte, el depósito de garantía.';
const BLUE_WITHOUT_DEPOSIT =
	'El transporte y el total son lo que se le cobra al cliente, no pagos recibidos. Registra el pago con «Registrar pago».';

const orderInput = {
	client_id: 1,
	client_name: 'Luz Marina Restrepo',
	client_phone: '310 442 8890',
	event_date: '2026-08-15',
	delivery_date: '2026-08-14',
	pickup_date: '2026-08-16',
	rental_days: 2,
	delivery_attributes: { method: 'COMPANY_DELIVERY', time: '14:00', ...address },
	pickup_attributes: { method: 'COMPANY_PICKUP', time: '09:00', ...address },
	order_items: [{ product_id: 1, qty: 10, unit_price: 2500 }],
	discount: 0,
	transport_cost: 180000,
	deposit_amount: 200000
};

let db: D1Database;
let database: ReturnType<typeof createMemoryD1>['database'];

beforeEach(() => {
	({ db, database } = createMemoryD1());
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	database.exec(
		`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values ('573104428890', 'Luz Marina Restrepo', '@573104428890', '[]', ${AUDIT});
		insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values ('Silla Tiffany dorada', 'CHAIRS_TABLES', 2500, 500, 1, ${AUDIT})`
	);
});

async function newOrder(overrides: object = {}): Promise<number> {
	const created = await createOrder(db, { ...orderInput, ...overrides }, sales);
	if (!created.ok) {
		throw new Error(JSON.stringify(created));
	}
	return created.id;
}

async function detailAt(id: number, query: string): Promise<string> {
	state.page.url = new URL(`http://localhost/pedidos/${id}${query}`);
	const event = { locals: { user: sales }, params: { id: String(id) }, platform: { env: { DB: db } } };
	const data = await load(event as never);
	return render(Page, { props: { data, form: null } as never }).body;
}

// Where a form's action sends the browser once it saved.
async function locationAfter(post: () => unknown): Promise<string> {
	try {
		await post();
	} catch (thrown) {
		if (isRedirect(thrown)) {
			return thrown.location;
		}
		throw thrown;
	}
	throw new Error('The action did not redirect');
}

function postOf(order: object, url = 'http://localhost/'): object {
	const formData = new FormData();
	formData.set('order', JSON.stringify(order));
	formData.set('force', '1');
	const request = new Request(url, { method: 'POST', body: formData });
	return { locals: { user: sales }, platform: { env: { DB: db } }, request, url: new URL(url) };
}

test('a new order’s detail shows the green notice and under it the blue one', async () => {
	const body = await detailAt(await newOrder(), '?guardado=nuevo');
	expect(body.indexOf(GREEN)).toBeGreaterThan(-1);
	expect(body.indexOf(BLUE)).toBeGreaterThan(body.indexOf(GREEN));
});

test('with an agreed deposit of $0 the blue notice leaves the deposit out', async () => {
	const body = await detailAt(await newOrder({ deposit_amount: 0 }), '?guardado=nuevo');
	expect(body).toContain(BLUE_WITHOUT_DEPOSIT);
	expect(body).not.toContain(BLUE);
});

test('a saved edit shows only the green notice; a later visit or a payment, neither', async () => {
	const id = await newOrder();
	const edited = await detailAt(id, '?guardado');
	expect(edited).toContain(GREEN);
	expect(edited).not.toContain('no pagos recibidos');
	for (const query of ['', '?pago=1']) {
		const later = await detailAt(id, query);
		expect(later).not.toContain(GREEN);
		expect(later).not.toContain('no pagos recibidos');
	}
});

test('«Convertir en pedido» › «Guardar pedido» lands on the new order with `guardado=nuevo`', async () => {
	const quote = await createQuote(
		db,
		{
			client_id: 1,
			client_name: 'Luz Marina Restrepo',
			valid_until: '2099-12-31',
			rental_days: 2,
			quote_items: orderInput.order_items,
			discount: 0,
			transport_cost: 180000
		},
		sales
	);
	if (!quote.ok) {
		throw new Error(JSON.stringify(quote));
	}
	const post = postOf(orderInput, `http://localhost/pedidos/nuevo?cotizacion=${quote.id}`);
	const location = await locationAfter(() => convertActions.default(post as never));
	expect(location).toMatch(/^\/pedidos\/\d+\?guardado=nuevo$/);
});

test('«Extender pedido» lands on the extension with `guardado=nuevo`', async () => {
	const parent = await newOrder();
	database.exec(`update orders set status = 'DELIVERED' where id = ${parent}`);
	const post = { ...postOf({ ...orderInput, pickup_date: '2026-08-20' }), params: { id: String(parent) } };
	const location = await locationAfter(() => extensionActions.default(post as never));
	expect(location).toMatch(/^\/pedidos\/\d+\?guardado=nuevo$/);
	expect(location).not.toBe(`/pedidos/${parent}?guardado=nuevo`);
});

test('saving an edit lands on the order with `guardado` alone', async () => {
	const id = await newOrder();
	const post = { ...postOf(orderInput), params: { id: String(id) } };
	const location = await locationAfter(() => editActions.default(post as never));
	expect(location).toBe(`/pedidos/${id}?guardado`);
});
