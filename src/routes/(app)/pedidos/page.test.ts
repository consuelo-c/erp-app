import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import type { OrderPage, OrderSummary } from '$lib/server/services/orders';
import Page from './+page.svelte';

const order: OrderSummary = {
	id: 1052,
	clientName: 'Luz Marina Restrepo',
	eventDate: '2026-10-17',
	status: 'CONFIRMED',
	hasIncident: false,
	deliveryMethod: 'COMPANY_DELIVERY',
	orderTotal: 250000,
	balanceDue: 0,
	receivableId: null
};

function listOf(orders: OrderSummary[], delivery: OrderPage['filters']['delivery']): string {
	const data = { orders, total: orders.length, pageCount: 1, filters: { delivery, page: 1 } };
	// Svelte's hydration markers out, so the markup reads as written.
	return render(Page, { props: { data } as never }).body.replaceAll(/<!--[^>]*-->/g, '');
}

// The page takes no role: the load already lets only ADMIN, MANAGER and SALES in, and the slot
// is the same for the three, on a phone and on a desktop, which share its markup.
const ORIGIN_SLOT =
	/<div class="screen__action"><p[^>]*>Un pedido se crea al convertir una cotización\.<\/p>\s*<a href="\/cotizaciones" class="btn btn--secondary[^"]*">Ver cotizaciones<\/a>\s*<a href="\/cotizaciones\/nueva" class="btn [^"]*">Nueva cotización<\/a><\/div>/;

test('with orders, the action slot says where an order comes from and links to the quotes', () => {
	expect(listOf([order], 'THIS_WEEK')).toMatch(ORIGIN_SLOT);
});

test('with none matching the filters, the slot is still there', () => {
	expect(listOf([], 'THIS_WEEK')).toMatch(ORIGIN_SLOT);
});

test('the empty list shows only «Aún no hay pedidos.» above the slot', () => {
	const body = listOf([], 'ALL');
	expect(body).toMatch(/Aún no hay pedidos\.<\/p>\s*<\/div>/);
	expect(body.match(/Un pedido se crea al convertir una cotización\./g)).toHaveLength(1);
	expect(body).toMatch(ORIGIN_SLOT);
});

test('no «Nuevo pedido»', () => {
	expect(listOf([order], 'ALL')).not.toContain('Nuevo pedido');
});
