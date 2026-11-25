import { expect, test } from 'vitest';
import { isCancelledOnItsWay } from '$lib/orders';
import { getCashBook } from '../services/cash';
import { getContact } from '../services/contacts';
import { getEmployee } from '../services/employees';
import { listLogins } from '../services/logins';
import { getOrderDetail, getOrderTimeline } from '../services/orders';
import { getProduct, listProducts } from '../services/products';
import { getQuoteDetail, getSourceQuoteId } from '../services/quotes';
import { readSettings } from '../services/settings';
import { actorWith, ADMIN, createFixture, DRIVER, MANAGER, SALES, WAREHOUSE } from './fixture';

test('the settings from settings-defaults.sql are always there', async () => {
	const { db } = createFixture();
	expect(await readSettings(db, ['COMPANY_NAME'])).toEqual({
		COMPANY_NAME: 'Banquetes Consuelo C'
	});
});

test('the catalog loads only when asked for', async () => {
	const bare = createFixture();
	expect((await listProducts(bare.db, {}, MANAGER)).products).toEqual([]);
	const withCatalog = createFixture({ catalog: true });
	expect((await listProducts(withCatalog.db, {}, MANAGER)).products.length).toBeGreaterThan(100);
});

test('a contact is found by the contacts service, and two of them do not collide', async () => {
	const { db, contact } = createFixture();
	const first = await contact({ full_name: 'Luz Marina Restrepo' });
	const second = await contact();
	expect(await getContact(db, first, SALES)).toMatchObject({ fullName: 'Luz Marina Restrepo' });
	const [one, other] = [await getContact(db, first, SALES), await getContact(db, second, SALES)];
	expect(other?.id).not.toBe(one?.id);
	expect(other?.phone).not.toBe(one?.phone);
	expect(other?.documentId).not.toBe(one?.documentId);
});

test('a write the service refuses throws with its reason', async () => {
	const { contact } = createFixture();
	await expect(contact({ full_name: ' ' })).rejects.toThrow('Escribe el nombre');
});

test('a product is a real, active one, and two of them do not collide', async () => {
	const { db, product } = createFixture();
	const chairs = await product({ name: 'Silla Tiffany', rental_price: '6.500' });
	const other = await product();
	expect(await getProduct(db, chairs, MANAGER)).toMatchObject({
		name: 'Silla Tiffany',
		rentalPrice: 6500,
		isActive: true
	});
	expect(await getProduct(db, other, MANAGER)).toMatchObject({
		isActive: true,
		rentalPrice: expect.any(Number),
		totalQuantity: expect.any(Number)
	});
});

test('a quote with no arguments has its own client and product, priced as the form saves it', async () => {
	const { db, quote } = createFixture();
	const id = await quote();
	const read = await getQuoteDetail(db, id, SALES);
	expect(read).toMatchObject({ state: 'VALID', orderId: null });
	expect(await getContact(db, read!.clientId, SALES)).toMatchObject({
		fullName: read!.client.name
	});
	expect(read!.items).toHaveLength(1);
	expect(read!.itemsTotal).toBe(read!.items[0].line_total);
	expect(read!.quoteTotal).toBe(read!.itemsTotal);
});

test('a quote takes the lines and client it is given', async () => {
	const { db, contact, product, quote } = createFixture();
	const client = await contact({ full_name: 'Luz Marina Restrepo' });
	const chairs = await product({ name: 'Silla Tiffany', rental_price: '6.500' });
	const id = await quote({
		client_id: client,
		rental_days: 2,
		quote_items: [{ product_id: chairs, qty: 10, unit_price: 6000 }]
	});
	expect(await getQuoteDetail(db, id, SALES)).toMatchObject({
		clientId: client,
		client: { name: 'Luz Marina Restrepo' },
		items: [{ product_id: chairs, name: 'Silla Tiffany', qty: 10, list_price: 6500 }],
		itemsTotal: 120000
	});
});

test('an order with no arguments is born CONFIRMED from a quote, with its own client and product, transport $0', async () => {
	const { db, order } = createFixture();
	const id = await order();
	const read = await getOrderDetail(db, id, SALES);
	expect(read).toMatchObject({ status: 'CONFIRMED', transportCost: 0 });
	expect(read!.items).toHaveLength(1);
	expect(await getContact(db, read!.clientId, SALES)).toMatchObject({
		fullName: read!.client.name
	});
	expect(await getSourceQuoteId(db, id, SALES)).toEqual(expect.any(Number));
});

test('an order DELIVERED reads back at that status, with each transition in its timeline', async () => {
	const { db, order } = createFixture();
	const id = await order({ status: 'DELIVERED' });
	expect(await getOrderDetail(db, id, SALES)).toMatchObject({ status: 'DELIVERED' });
	const timeline = await getOrderTimeline(db, id, MANAGER);
	expect(timeline?.map((entry) => [entry.action, entry.status]).reverse()).toEqual([
		['CREATED', 'CONFIRMED'],
		['STATUS_CHANGED', 'PICKED'],
		['STATUS_CHANGED', 'OUT_FOR_DELIVERY'],
		['STATUS_CHANGED', 'DELIVERED']
	]);
});

test('an order follows its methods: a client pickup and return skip both trips', async () => {
	const { db, order } = createFixture();
	const trip = { time: null, address_1: 'Bodega' };
	const id = await order({
		status: 'COMPLETED',
		delivery_attributes: { ...trip, method: 'CLIENT_PICKUP' },
		pickup_attributes: { ...trip, method: 'CLIENT_RETURN' }
	});
	const timeline = await getOrderTimeline(db, id, MANAGER);
	expect(timeline?.map((entry) => entry.status).reverse()).toEqual([
		'CONFIRMED',
		'PICKED',
		'DELIVERED',
		'COMPLETED'
	]);
});

test('an order cancelled from OUT_FOR_DELIVERY reads as cancelled on its way', async () => {
	const { db, order } = createFixture();
	const id = await order({ status: 'CANCELLED', cancelledFrom: 'OUT_FOR_DELIVERY' });
	const read = await getOrderDetail(db, id, SALES);
	expect(read).toMatchObject({
		status: 'CANCELLED',
		cancellation: { cancelledFrom: 'OUT_FOR_DELIVERY', reason: expect.any(String) }
	});
	expect(isCancelledOnItsWay(read!.cancellation)).toBe(true);
});

test('an order cancelled with no status to cancel from is cancelled from CONFIRMED', async () => {
	const { db, order } = createFixture();
	const id = await order({ status: 'CANCELLED' });
	expect(await getOrderDetail(db, id, SALES)).toMatchObject({
		cancellation: { cancelledFrom: 'CONFIRMED' }
	});
});

test('an order takes its lines, dates, transport, deposit and client', async () => {
	const { db, contact, product, order } = createFixture();
	const client = await contact({ full_name: 'Luz Marina Restrepo' });
	const chairs = await product({ name: 'Silla Tiffany', rental_price: '6.500' });
	const id = await order({
		client_id: client,
		event_date: '2026-08-15',
		delivery_date: '2026-08-14',
		pickup_date: '2026-08-16',
		rental_days: 2,
		order_items: [{ product_id: chairs, qty: 10, unit_price: 6000 }],
		transport_cost: 50000,
		deposit_amount: 100000
	});
	expect(await getOrderDetail(db, id, SALES)).toMatchObject({
		clientId: client,
		client: { name: 'Luz Marina Restrepo' },
		eventDate: '2026-08-15',
		deliveryDate: '2026-08-14',
		pickupDate: '2026-08-16',
		items: [{ product_id: chairs, qty: 10, unit_price: 6000 }],
		transportCost: 50000,
		orderTotal: 170000,
		depositAmount: 100000
	});
});

test('an order skips the shortage check unless the test opts back in', async () => {
	const { db, product, order } = createFixture();
	const few = await product({ total_quantity: '2' });
	const lines = [{ product_id: few, qty: 5, unit_price: 10000 }];
	const forced = await order({ order_items: lines });
	expect(await getOrderDetail(db, forced, SALES)).toMatchObject({ status: 'CONFIRMED' });
	await expect(order({ order_items: lines, force: false })).rejects.toThrow('shortages');
});

test('an illegal path is a setup error, not a fake status', async () => {
	const { order } = createFixture();
	const trip = { time: null, address_1: 'Bodega' };
	await expect(
		order({ status: 'OUT_FOR_DELIVERY', delivery_attributes: { ...trip, method: 'CLIENT_PICKUP' } })
	).rejects.toThrow('OUT_FOR_DELIVERY');
});

test('a payment shows on the order balance and in the cash book', async () => {
	const { db, order, payment } = createFixture();
	const id = await order();
	const total = (await getOrderDetail(db, id, SALES))!.orderTotal;
	const movement = await payment(id, { amount: '4.000' });
	const read = await getOrderDetail(db, id, SALES);
	expect(read).toMatchObject({ paid: 4000, balanceDue: total - 4000 });
	expect(read!.payments).toMatchObject([{ id: movement, concept: 'INSTALLMENT', amount: 4000 }]);
	const { entries } = await getCashBook(db, {}, MANAGER);
	expect(entries).toMatchObject([{ id: movement, amount: 4000 }]);
});

test('two payments on one order get their own receipts', async () => {
	const { db, order, payment } = createFixture();
	const id = await order();
	await payment(id, { amount: '1.000' });
	await payment(id, { amount: '1.000' });
	const receipts = (await getOrderDetail(db, id, SALES))!.payments.map(
		(each) => each.receiptNumber
	);
	expect(new Set(receipts).size).toBe(2);
});

test('an employee is a real login: its actor matches what is stored', async () => {
	const { db, employee } = createFixture();
	const driver = await employee({ roles: ['DRIVER', 'SALES'] });
	const other = await employee({ roles: ['WAREHOUSE'] });
	const logins = await listLogins(db, ADMIN);
	const stored = logins.find((login) => login.username === driver.username);
	expect(stored).toMatchObject({
		roles: driver.roles,
		employee: { id: driver.employeeId },
		isActive: true
	});
	expect(driver).toMatchObject({ kind: 'user', employeeId: expect.any(Number) });
	expect([...driver.roles].sort()).toEqual(['DRIVER', 'SALES']);
	expect(await getEmployee(db, driver.employeeId!, MANAGER)).toMatchObject({ isEmployed: true });
	expect(other.employeeId).not.toBe(driver.employeeId);
	expect(other.username).not.toBe(driver.username);
});

test('the role actors and actorWith are logins with no employee', () => {
	expect([ADMIN, MANAGER, SALES, WAREHOUSE, DRIVER].map((actor) => actor.roles)).toEqual([
		['ADMIN'],
		['MANAGER'],
		['SALES'],
		['WAREHOUSE'],
		['DRIVER']
	]);
	expect(actorWith('SALES', 'DRIVER')).toEqual({
		username: expect.any(String),
		employeeId: null,
		roles: ['SALES', 'DRIVER'],
		kind: 'user'
	});
});

test('two orders in one test each get their own client and product', async () => {
	const { db, order } = createFixture();
	const [first, second] = [await order(), await order()];
	const [one, other] = [
		await getOrderDetail(db, first, SALES),
		await getOrderDetail(db, second, SALES)
	];
	expect(other!.clientId).not.toBe(one!.clientId);
	expect(other!.items[0].product_id).not.toBe(one!.items[0].product_id);
});
