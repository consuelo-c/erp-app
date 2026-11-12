import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Actor } from '$lib/server/actor';
import { createMemoryD1 } from '$lib/server/db/memory-d1';
import { createOrder } from '$lib/server/db/test-orders';
import { issueReceivable } from '$lib/server/services/receivables';
import { load } from './+page.server';

const AUDIT = "0, 'admin', 0, 'admin'";
const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };
const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: null };

// A completed order, billable today, of a client with a document.
async function billableOrder() {
	const { db, database } = createMemoryD1();
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	database.exec(
		`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values ('573104428890', 'Postobón S.A.', '8909039395', '[]', ${AUDIT});
		insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values ('Silla Tiffany dorada', 'CHAIRS_TABLES', 2500, 500, 1, ${AUDIT})`
	);
	const created = await createOrder(
		db,
		{
			client_id: 1,
			client_name: 'Postobón S.A.',
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
	database.exec(`update orders set status = 'COMPLETED' where id = ${created.id}`);
	return { db, id: created.id };
}

function loadAs(db: D1Database, id: number, user: Actor) {
	const event = { locals: { user }, params: { id: String(id) }, platform: { env: { DB: db } } };
	return load(event as never) as Promise<{ canIssueReceivable: boolean }>;
}

test('SALES is offered «Emitir cuenta de cobro» on an order that can start one, and not once billed', async () => {
	const { db, id } = await billableOrder();
	expect((await loadAs(db, id, sales)).canIssueReceivable).toBe(true);
	const issued = await issueReceivable(db, { orders: [id], payment_terms: 'Contado' }, sales);
	expect(issued).toMatchObject({ ok: true });
	expect((await loadAs(db, id, sales)).canIssueReceivable).toBe(false);
});
