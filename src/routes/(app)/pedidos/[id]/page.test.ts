import { isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { beforeEach, expect, test, vi } from 'vitest';
import { createFixture, MANAGER, SALES } from '$lib/server/db/fixture';
import { getContact, updateContact } from '$lib/server/services/contacts';
import {
	actions as quoteEditActions,
	load as loadQuoteEdit
} from '../../cotizaciones/[id]/editar/+page.server';
import QuoteEditPage from '../../cotizaciones/[id]/editar/+page.svelte';
import { actions as convertActions, load as loadConversion } from '../nuevo/+page.server';
import ConversionPage from '../nuevo/+page.svelte';
import { actions as editActions, load as loadEdit } from './editar/+page.server';
import EditPage from './editar/+page.svelte';
import { actions as extensionActions } from './extension/+page.server';
import { load } from './+page.server';
import Page from './+page.svelte';

// The detail reads its notices from the URL the form's redirect leaves.
const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/pedidos/1') } }));
vi.mock('$app/state', () => state);

const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: null };

const GREEN = 'Pedido guardado con éxito';
const BLUE =
	'El transporte, el depósito y el total son lo que se le cobra al cliente, no pagos recibidos. Registra con «Registrar pago» el pago del pedido y, aparte, el depósito de garantía.';
const BLUE_WITHOUT_DEPOSIT =
	'El transporte y el total son lo que se le cobra al cliente, no pagos recibidos. Registra el pago con «Registrar pago».';

let db: D1Database;
let fixture: ReturnType<typeof createFixture>;
let LUZ_MARINA: number;
let orderInput: Record<string, unknown>;

beforeEach(async () => {
	fixture = createFixture();
	({ db } = fixture);
	LUZ_MARINA = await fixture.contact({ full_name: 'Luz Marina Restrepo', phone: '310 442 8890' });
	const product = await fixture.product({ name: 'Silla Tiffany dorada', rental_price: '2500' });
	orderInput = {
		client_id: LUZ_MARINA,
		client_name: 'Luz Marina Restrepo',
		client_phone: '310 442 8890',
		event_date: '2026-08-15',
		delivery_date: '2026-08-14',
		pickup_date: '2026-08-16',
		rental_days: 2,
		delivery_attributes: { method: 'COMPANY_DELIVERY', time: '14:00', ...address },
		pickup_attributes: { method: 'COMPANY_PICKUP', time: '09:00', ...address },
		order_items: [{ product_id: product, qty: 10, unit_price: 2500 }],
		discount: 0,
		transport_cost: 180000,
		deposit_amount: 200000
	};
});

function newOrder(overrides: object = {}): Promise<number> {
	return fixture.order({ ...orderInput, ...overrides });
}

async function detailAt(id: number, query: string): Promise<string> {
	state.page.url = new URL(`http://localhost/pedidos/${id}${query}`);
	const event = {
		locals: { user: SALES },
		params: { id: String(id) },
		platform: { env: { DB: db } }
	};
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
	return { locals: { user: SALES }, platform: { env: { DB: db } }, request, url: new URL(url) };
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
	const quote = await newQuote();
	const post = postOf(orderInput, `http://localhost/pedidos/nuevo?cotizacion=${quote}`);
	const location = await locationAfter(() => convertActions.default(post as never));
	expect(location).toMatch(/^\/pedidos\/\d+\?guardado=nuevo$/);
});

test('«Extender pedido» lands on the extension with `guardado=nuevo`', async () => {
	const parent = await newOrder({ status: 'DELIVERED' });
	const post = {
		...postOf({ ...orderInput, pickup_date: '2026-08-20' }),
		params: { id: String(parent) }
	};
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

const BANNED_WARNING = '⚠ Cliente vetado. Puedes continuar igual.';

// Contactos › Editar as the manager saves it: Luz Marina as she is, labelled Vetado.
async function banClient() {
	const current = await getContact(db, LUZ_MARINA, MANAGER);
	if (null === current) {
		throw new Error('Luz Marina not found');
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
	const form = { id: LUZ_MARINA, ...Object.fromEntries(posted), labels: ['BANNED'] };
	expect(await updateContact(db, form, MANAGER)).toMatchObject({ ok: true });
}

type Route = { page: unknown; load: unknown };

// The form as the route renders it, its data from the route's own load.
async function rendered({ page, load }: Route, params: object, url = 'http://localhost/') {
	const event = {
		locals: { user: SALES },
		params,
		platform: { env: { DB: db } },
		url: new URL(url)
	};
	const data = await (load as (event: never) => Promise<unknown>)(event as never);
	return render(page as never, { props: { data, form: null } as never }).body;
}

function quoteInput() {
	return {
		client_id: LUZ_MARINA,
		client_name: 'Luz Marina Restrepo',
		valid_until: '2099-12-31',
		rental_days: 2,
		quote_items: orderInput.order_items,
		discount: 0,
		transport_cost: 180000,
		transported_by: 'COMPANY'
	};
}

function newQuote(): Promise<number> {
	return fixture.quote(quoteInput());
}

test('a Vetado client warns under «Cliente» when the order loads, and the edit still saves', async () => {
	const id = await newOrder();
	expect(await rendered({ page: EditPage, load: loadEdit }, { id: String(id) })).not.toContain(
		BANNED_WARNING
	);
	await banClient();
	expect(await rendered({ page: EditPage, load: loadEdit }, { id: String(id) })).toContain(
		BANNED_WARNING
	);
	const post = { ...postOf(orderInput), params: { id: String(id) } };
	expect(await locationAfter(() => editActions.default(post as never))).toBe(
		`/pedidos/${id}?guardado`
	);
});

test('a Vetado client warns under «Cliente» when a quote loads, edited or converted, and it saves', async () => {
	const quote = await newQuote();
	await banClient();
	const edit = await rendered({ page: QuoteEditPage, load: loadQuoteEdit }, { id: String(quote) });
	expect(edit).toContain(BANNED_WARNING);
	const url = `http://localhost/pedidos/nuevo?cotizacion=${quote}`;
	expect(await rendered({ page: ConversionPage, load: loadConversion }, {}, url)).toContain(
		BANNED_WARNING
	);
	const formData = new FormData();
	formData.set('quote', JSON.stringify(quoteInput()));
	const request = new Request('http://localhost/', { method: 'POST', body: formData });
	const post = { locals: { user: SALES }, platform: { env: { DB: db } }, request };
	const saved = () => quoteEditActions.default({ ...post, params: { id: String(quote) } } as never);
	expect(await locationAfter(saved)).toBe(`/cotizaciones/${quote}?guardado`);
});
