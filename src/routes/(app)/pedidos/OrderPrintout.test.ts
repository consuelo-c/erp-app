import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { beforeAll, expect, test, vi } from 'vitest';
import type { Actor } from '$lib/server/actor';
import { createMemoryD1 } from '$lib/server/db/memory-d1';
import { createOrder } from '$lib/server/db/test-orders';
import {
	getOrderPrintout,
	type OrderPrintout as Printout,
	type OrderStatus
} from '$lib/server/services/orders';
import DispatchPrintoutPage from '../despachos/[id]/impresion/+page@.svelte';
import OrderPrintout from './OrderPrintout.svelte';

// The dispatch printout's back link keeps the detail's query.
const state = vi.hoisted(() => ({
	page: { url: new URL('http://localhost/despachos/1/impresion') }
}));
vi.mock('$app/state', () => state);

const AUDIT = "0, 'admin', 0, 'admin'";
const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };
const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: null };

let db: D1Database;
let database: DatabaseSync;
let printout: Printout;

type Movements = { deposits?: number[]; installments?: number[] };

/** A movement's concept, and its refund's for a negative amount. */
type MovementKind = { concept: string; refundConcept: string };
const DEPOSIT: MovementKind = { concept: 'SECURITY_DEPOSIT', refundConcept: 'DEPOSIT_REFUND' };
const INSTALLMENT: MovementKind = { concept: 'INSTALLMENT', refundConcept: 'INSTALLMENT_REFUND' };

/** A movement on order `orderId`, its refund's concept when `amount` is negative. */
function insertMovement(orderId: number, { concept, refundConcept }: MovementKind, amount: number) {
	database.exec(
		`insert into cash_movements (concept, payment_method, amount, movement_date, entity_type, entity_id, payee, receipt_number, created_at, created_by, updated_at, updated_by)
		values ('${amount > 0 ? concept : refundConcept}', 'CASH', ${amount}, '2026-08-10', 'ORDER', ${orderId}, 'Luz Marina Restrepo', (select coalesce(max(receipt_number), 0) + 1 from cash_movements), ${AUDIT})`
	);
}

/**
 * A CONFIRMED order agreeing `depositAmount`, with these deposit and installment movements (a
 * negative one is its refund), read as its sheet.
 */
async function printoutWith(
	depositAmount: number,
	{ deposits = [], installments = [] }: Movements = {}
): Promise<Printout> {
	const created = await createOrder(
		db,
		{
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
			deposit_amount: depositAmount
		},
		sales
	);
	if (!created.ok) {
		throw new Error(JSON.stringify(created.errors));
	}
	for (const amount of deposits) {
		insertMovement(created.id, DEPOSIT, amount);
	}
	for (const amount of installments) {
		insertMovement(created.id, INSTALLMENT, amount);
	}
	const read = await getOrderPrintout(db, String(created.id), sales);
	if (null === read) {
		throw new Error('No printout');
	}
	return read;
}

// One real order's sheet; each case swaps only the client's frozen phone and username.
beforeAll(async () => {
	({ db, database } = createMemoryD1());
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	database.exec(
		`insert into contacts (phone, full_name, document_id, labels, created_at, created_by, updated_at, updated_by) values ('573104428890', 'Luz Marina Restrepo', '@luz', '[]', ${AUDIT});
		insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values ('Silla Tiffany dorada', 'CHAIRS_TABLES', 2500, 500, 1, ${AUDIT})`
	);
	printout = await printoutWith(0);
});

function sheetOf(read: Printout, status: OrderStatus = 'CONFIRMED'): string {
	const props = { printout: { ...read, order: { ...read.order, status } }, backHref: '/pedidos/1' };
	return render(OrderPrintout, { props }).body;
}

test('«Depósito: $20.000 de $50.000», received of agreed, right after «Total»', async () => {
	const body = sheetOf(await printoutWith(50000, { deposits: [20000] }));
	expect(body).toMatch(
		/<span>Total<\/span><span>\$50\.000<\/span><\/div>\s*<!--\[0--><div class="print-row"><span>Depósito: \$20\.000 de \$50\.000<\/span><\/div>/
	);
});

test('received is net of «Devolución de depósito», as «Depósito recibido» reads it', async () => {
	const read = await printoutWith(50000, { deposits: [50000, -30000] });
	expect(read.order.depositHeld).toBe(20000);
	expect(sheetOf(read)).toContain('<span>Depósito: $20.000 de $50.000</span>');
});

test('no deposit line with none agreed, nor on a COMPLETED or CANCELLED order', async () => {
	const agreed = await printoutWith(50000, { deposits: [50000] });
	for (const body of [
		sheetOf(printout),
		sheetOf(agreed, 'COMPLETED'),
		sheetOf(agreed, 'CANCELLED')
	]) {
		expect(body).toContain('<span>Total</span>');
		expect(body).not.toContain('Depósito');
	}
});

test('a CANCELLED order with nothing paid reads «A favor del cliente $0», never its total as «Saldo»', () => {
	const body = sheetOf(printout, 'CANCELLED');
	expect(body).toContain('<span>Pagado</span><span>$0</span>');
	expect(body).toMatch(
		/<div class="print-row print-row--strong"><span>A favor del cliente<\/span><span>\$0<\/span>/
	);
	expect(body).not.toContain('Saldo');
});

test('a CANCELLED order reads what the company holds: installments plus the deposit held', async () => {
	const body = sheetOf(
		await printoutWith(30000, { deposits: [30000], installments: [20000] }),
		'CANCELLED'
	);
	expect(body).toContain('<span>Pagado</span><span>$20.000</span>');
	expect(body).toContain('<span>A favor del cliente</span><span>$50.000</span>');
	expect(body).not.toContain('Saldo');
});

test("an order that isn't CANCELLED still reads «Saldo»", async () => {
	const body = sheetOf(await printoutWith(0, { installments: [20000] }));
	expect(body).toContain('<span>Saldo</span><span>$30.000</span>');
	expect(body).not.toContain('A favor del cliente');
});

function sheet(phone: string | null, whatsapp: string | null): string {
	const order = { ...printout.order, client: { ...printout.order.client, phone, whatsapp } };
	const props = { printout: { ...printout, order }, backHref: '/pedidos/1' };
	return render(OrderPrintout, { props }).body;
}

test('with a phone it prints «Teléfono», even when there is also a username', () => {
	const body = sheet('573104428890', 'mayc47');
	expect(body).toContain('<span>Teléfono</span><span>310 442 8890</span>');
	expect(body).not.toContain('@mayc47');
});

test('with only a username it prints «WhatsApp @mayc47»', () => {
	const body = sheet(null, 'mayc47');
	expect(body).toContain('<span>WhatsApp</span><span>@mayc47</span>');
	expect(body).not.toContain('Teléfono');
});

test('with neither it prints «Teléfono» blank, to be written in by hand', () => {
	expect(sheet(null, null)).toContain('<span>Teléfono</span><span></span>');
});

test('the toolbar offers «Volver» and «Imprimir», and the sheet prints unturned', () => {
	const { head, body } = render(OrderPrintout, { props: { printout, backHref: '/pedidos/1' } });
	expect(body).toMatch(/Volver al pedido[\s\S]*Imprimir/);
	expect(body).not.toContain('Vertical');
	expect(head).not.toContain('page-orientation');
});

test('the dates print as «Entrega aproximada» and «Recogida tentativa»; «Productos» counts lines', () => {
	const body = sheet('573104428890', null);
	expect(body).toContain('Entrega aproximada');
	expect(body).toContain('Recogida tentativa');
	expect(body).toContain('<span>Productos</span><span>1</span>');
	expect(body).toContain('1 de 1');
});

test('the sheet is titled «Remisión #NN», not «Pedido #NN»', () => {
	const body = sheetOf(printout);
	expect(body).toContain(`Remisión #${printout.order.id}`);
	expect(body).not.toContain(`Pedido #${printout.order.id}`);
});

test('the sheets print on a portrait letter page with no margin', () => {
	const { head } = render(OrderPrintout, { props: { printout, backHref: '/pedidos/1' } });
	expect(head).toMatch(/@page\s*\{\s*size:\s*letter;\s*margin:\s*0;?\s*\}/);
});

test('the dispatch sheets print on a portrait letter page with no margin', () => {
	const { head } = render(DispatchPrintoutPage, { props: { data: { printout } } as never });
	expect(head).toMatch(/@page\s*\{\s*size:\s*letter;\s*margin:\s*0;?\s*\}/);
});

test("the order and dispatch headers read the company's address and bare WhatsApp, no phone", () => {
	const dispatch = render(DispatchPrintoutPage, { props: { data: { printout } } as never }).body;
	for (const body of [sheetOf(printout), dispatch]) {
		expect(body).toContain(
			'<div class="print-small">Calle 38a #79-18, Medellín, Colombia · 300 611 3392</div>'
		);
		expect(body).not.toContain('604 411 44 29');
	}
});

/** The printout's sheet with `count` lines, each a copy of the order's line under its own name. */
function sheetWithLines(count: number, nameOf = (index: number) => `Producto ${index + 1}`) {
	const [line] = printout.order.items;
	const items = Array.from({ length: count }, (_, index) => ({
		...line,
		product_id: index + 1,
		name: nameOf(index)
	}));
	const props = { printout: { ...printout, order: { ...printout.order, items } }, backHref: '/' };
	return render(OrderPrintout, { props }).body;
}

test('a 15-line order, like #4107, prints on one sheet, «1 de 1», with its closing', () => {
	const body = sheetWithLines(15);
	expect(body.split('<article')).toHaveLength(2);
	expect(body).toContain('1 de 1');
	expect(body).toContain('Recibí');
	expect(body).toContain('<span>Total</span>');
	expect(body).toMatch(/Producto 8<[\s\S]*<\/table>[\s\S]*Producto 9</);
	expect(body).not.toMatch(/Producto 8<[\s\S]*Producto 9<[\s\S]*<\/table>[\s\S]*<table/);
});

test('a long product name prints whole in a cell that cuts it with an ellipsis, never wrapping', () => {
	const name = 'Mantel rectangular de lino bordado a mano color marfil para mesa de 2,40 m';
	const body = sheetWithLines(1, () => name);
	expect(body).toMatch(new RegExp(`<td class="print-table__name svelte-\\w+">${name}</td>`));
	const source = readFileSync('src/routes/(app)/pedidos/HalfLetterPrintout.svelte', 'utf8');
	const { css } = compile(source, { filename: 'HalfLetterPrintout.svelte' });
	const rule = css?.code.match(/\.print-table__name\.svelte-\w+\s*\{([^}]*)\}/)?.[1];
	for (const declaration of [
		'white-space: nowrap;',
		'overflow: hidden;',
		'text-overflow: ellipsis;'
	]) {
		expect(rule).toContain(declaration);
	}
});
