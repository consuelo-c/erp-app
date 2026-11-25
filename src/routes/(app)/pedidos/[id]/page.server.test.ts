import { expect, test } from 'vitest';
import type { Actor } from '$lib/server/actor';
import { createFixture, SALES } from '$lib/server/db/fixture';
import { cancelOrder } from '$lib/server/services/orders';
import { issueReceivable } from '$lib/server/services/receivables';
import { load } from './+page.server';

// A CONFIRMED order, as it's born, of a client with a document, with a $10.000 advance.
async function billableOrder() {
	const fixture = createFixture();
	const client = await fixture.contact({
		full_name: 'Postobón S.A.',
		phone: '310 442 8890',
		document_id: '8909039395'
	});
	const product = await fixture.product({ name: 'Silla Tiffany dorada', rental_price: '2500' });
	const id = await fixture.order({
		client_id: client,
		order_items: [{ product_id: product, qty: 10, unit_price: 2500 }]
	});
	await fixture.payment(id, { amount: '10.000' });
	return { db: fixture.db, id };
}

function loadAs(db: D1Database, id: number, user: Actor) {
	const event = { locals: { user }, params: { id: String(id) }, platform: { env: { DB: db } } };
	return load(event as never) as Promise<{ canIssueReceivable: boolean }>;
}

test('SALES is offered «Emitir cuenta de cobro» on a partly paid CONFIRMED order, and not once billed', async () => {
	const { db, id } = await billableOrder();
	expect((await loadAs(db, id, SALES)).canIssueReceivable).toBe(true);
	const issued = await issueReceivable(db, { orders: [id], payment_terms: 'Contado' }, SALES);
	expect(issued).toMatchObject({ ok: true });
	expect((await loadAs(db, id, SALES)).canIssueReceivable).toBe(false);
});

test('a CANCELLED order is not offered «Emitir cuenta de cobro»', async () => {
	const { db, id } = await billableOrder();
	const cancelled = await cancelOrder(db, { id, reason: 'El cliente canceló' }, SALES);
	expect(cancelled).toMatchObject({ ok: true });
	expect((await loadAs(db, id, SALES)).canIssueReceivable).toBe(false);
});
