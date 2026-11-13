import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { beforeAll, expect, test } from 'vitest';
import type { Actor } from '$lib/server/actor';
import { createMemoryD1 } from '$lib/server/db/memory-d1';
import { createOrder } from '$lib/server/db/test-orders';
import { getOrderPrintout, type OrderPrintout as Printout } from '$lib/server/services/orders';
import OrderPrintout from './OrderPrintout.svelte';

const AUDIT = "0, 'admin', 0, 'admin'";
const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };
const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: null };

let printout: Printout;

// One real order's sheet; each case swaps only the client's frozen phone and username.
beforeAll(async () => {
	const { db, database } = createMemoryD1();
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	database.exec(
		`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values ('573104428890', 'Luz Marina Restrepo', '@luz', '[]', ${AUDIT});
		insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values ('Silla Tiffany dorada', 'CHAIRS_TABLES', 2500, 500, 1, ${AUDIT})`
	);
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
			deposit_amount: 0
		},
		sales
	);
	if (!created.ok) {
		throw new Error(JSON.stringify(created.errors));
	}
	const read = await getOrderPrintout(db, String(created.id), sales);
	if (null === read) {
		throw new Error('No printout');
	}
	printout = read;
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
