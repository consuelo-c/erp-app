import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { createFixture, DRIVER, MANAGER, SALES } from '../db/fixture';
import { createPublicToken } from '../public-token';
import { reportIncident } from './incidents';
import { advanceOrder, getPublicToken, type OrderStatus } from './orders';
import {
	findOrderIdByToken,
	getClientTerms,
	getPublicOrder,
	getWhatsAppHref
} from './public-orders';
import { issueReceivable, recordReceivablePayment } from './receivables';
import { getSystemSettings, updateSystemSettings, updateTerms } from './settings';

let db: D1Database;
let fixture: ReturnType<typeof createFixture>;
let LUZ_MARINA: number;
let WILSON: number;
let TIFFANY: number;
let MESA: number;
let COPA: number;

beforeEach(async () => {
	// Saturday 17 October 2026, 9 a.m. in Bogotá: #1043's event day.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-17T14:00:00Z'));
	onTestFinished(() => {
		vi.useRealTimers();
	});
	fixture = createFixture();
	({ db } = fixture);
	LUZ_MARINA = await fixture.contact({ full_name: 'Luz Marina Restrepo', phone: '310 442 8890' });
	WILSON = await fixture.contact({
		full_name: 'Wilson Muñoz',
		phone: '311 908 5512',
		labels: ['TRANSPORTER']
	});
	const stocked = { total_quantity: '500' };
	TIFFANY = await fixture.product({
		name: 'Silla Tiffany dorada',
		rental_price: '2500',
		...stocked
	});
	MESA = await fixture.product({
		name: 'Mesa redonda 10 puestos',
		rental_price: '12000',
		...stocked
	});
	COPA = await fixture.product({ name: 'Copa para vino tinto', rental_price: '900', ...stocked });
});

const address = { address_1: 'Cra 43A #18-95, El Poblado', address_2: 'Salón Social Torre Verde' };

// The Design Brief's order #1043.
function order1043() {
	return {
		client_id: LUZ_MARINA,
		event_date: '2026-10-17',
		delivery_date: '2026-10-16',
		pickup_date: '2026-10-18',
		rental_days: 2,
		delivery_attributes: { method: 'COMPANY_DELIVERY', time: '14:00', ...address },
		pickup_attributes: { method: 'COMPANY_PICKUP', time: '09:00', ...address },
		order_items: [
			{ product_id: TIFFANY, qty: 120, unit_price: 2500 },
			{ product_id: MESA, qty: 12, unit_price: 12000 },
			{ product_id: COPA, qty: 120, unit_price: 900 }
		],
		discount: 104000,
		transport_cost: 180000,
		deposit_amount: 200000
	};
}

/** #1043 (with `fields` over it) in `status`, and its client link's token. */
async function create(
	status: OrderStatus = 'CONFIRMED',
	fields: object = {}
): Promise<{ id: number; token: string }> {
	const id = await fixture.order({ ...order1043(), ...fields, status });
	return { id, token: String(await getPublicToken(db, id, SALES)) };
}

// Configuración › Empresa as the manager saves it, with the WhatsApp typed over it.
async function setCompanyWhatsApp(whatsapp: string): Promise<void> {
	const values = await getSystemSettings(db, ['COMPANY'], MANAGER);
	const form = { ...values, COMPANY_WHATSAPP: whatsapp };
	expect(await updateSystemSettings(db, { modules: ['COMPANY'], values: form }, MANAGER)).toEqual({
		ok: true
	});
}

test("#1043's page: the printout's figures, and exactly the fields the client sees", async () => {
	const { id, token } = await create();
	await fixture.payment(id, {
		amount: '500.000',
		payment_method: 'TRANSFER',
		movement_date: '2026-10-10'
	});
	expect(await getPublicOrder(db, token)).toEqual({
		id,
		status: 'CONFIRMED',
		clientName: 'Luz Marina Restrepo',
		eventDate: '2026-10-17',
		rentalDays: 2,
		delivery: { method: 'COMPANY_DELIVERY', ...address },
		pickup: { method: 'COMPANY_PICKUP' },
		items: [
			{ name: 'Silla Tiffany dorada', qty: 120, unit_price: 2500, line_total: 600000 },
			{ name: 'Mesa redonda 10 puestos', qty: 12, unit_price: 12000, line_total: 288000 },
			{ name: 'Copa para vino tinto', qty: 120, unit_price: 900, line_total: 216000 }
		],
		itemsTotal: 1104000,
		discount: 104000,
		transportCost: 180000,
		orderTotal: 1180000,
		depositAmount: 200000,
		depositHeld: 0,
		paid: 500000,
		balanceDue: 680000,
		damageCharged: 0,
		owedToClient: 500000,
		receivableId: null,
		receivableBalance: null
	});
});

test("a billed order carries its cuenta's balance, net of the cuenta's own payment", async () => {
	const { id, token } = await create('COMPLETED');
	const issued = await issueReceivable(db, { orders: [id], payment_terms: 'Contado' }, SALES);
	if (!issued.ok) {
		throw new Error(issued.message);
	}
	expect(await getPublicOrder(db, token)).toMatchObject({
		receivableId: issued.id,
		receivableBalance: 1180000
	});
	// A cuenta is paid once and in full: its own payment leaves nothing.
	const payment = {
		id: String(issued.id),
		payment_method: 'CASH',
		amount: '1.180.000',
		movement_date: '2026-10-17'
	};
	expect(await recordReceivablePayment(db, payment, MANAGER)).toMatchObject({ ok: true });
	expect(await getPublicOrder(db, token)).toMatchObject({
		receivableId: issued.id,
		receivableBalance: 0
	});
});

test('never the carrier, trip dates, times, notes, list prices, phone, incident or payments', async () => {
	const external = { method: 'EXTERNAL_CARRIER', carrier_id: WILSON, time: '14:00', ...address };
	const { id, token } = await create('DELIVERED', {
		delivery_attributes: external,
		pickup_attributes: {
			method: 'COMPANY_PICKUP',
			time: '14:00',
			address_1: 'Finca La Esperanza'
		},
		notes: 'Cliente difícil'
	});
	// The driver's note on the pickup, then a chair lost: an active incident.
	const pickup = { id, status: 'OUT_FOR_PICKUP', notes: 'Portería cerrada' };
	expect(await advanceOrder(db, pickup, DRIVER)).toMatchObject({ ok: true });
	const items = [{ product_id: TIFFANY, qty: 1, outcome: 'LOST' }];
	const incident = { order_id: id, incident_description: 'Se perdió una silla', items };
	expect(await reportIncident(db, incident, DRIVER)).toMatchObject({ ok: true });
	const order = await getPublicOrder(db, token);
	const keys = JSON.stringify(order).match(/"\w+":/g) ?? [];
	for (const forbidden of [
		'carrier',
		'notes',
		'list_price',
		'client_id',
		'clientId',
		'phone',
		'whatsapp',
		'has_incident',
		'hasIncident',
		'time',
		'payments',
		'deliveryDate',
		'delivery_date',
		'pickupDate',
		'pickup_date'
	]) {
		expect(keys).not.toContain(`"${forbidden}":`);
	}
	const shown = JSON.stringify(order);
	for (const hidden of [
		'Wilson',
		'573119085512',
		'573104428890',
		'Cliente difícil',
		'Portería',
		'Finca La Esperanza',
		'14:00'
	]) {
		expect(shown).not.toContain(hidden);
	}
});

test('an unknown token, an event 31 days past or an id: no page', async () => {
	expect(await getPublicOrder(db, createPublicToken())).toBeNull();
	const thirtyOneDaysAgo = await create('COMPLETED', { event_date: '2026-09-16' });
	expect(await getPublicOrder(db, thirtyOneDaysAgo.token)).toBeNull();
	const { id } = await create();
	expect(await getPublicOrder(db, String(id))).toBeNull();
	expect(await getPublicOrder(db, id)).toBeNull();
});

test('an event 30 days past and a cancelled order still open', async () => {
	const thirtyDaysAgo = await create('COMPLETED', { event_date: '2026-09-17' });
	expect(await getPublicOrder(db, thirtyDaysAgo.token)).toMatchObject({ status: 'COMPLETED' });
	expect(await getPublicOrder(db, (await create('CANCELLED')).token)).toMatchObject({
		status: 'CANCELLED'
	});
});

test("the staff's link finds any order by its token, old included, never by its id", async () => {
	const old = await create('COMPLETED', { event_date: '2026-01-10' });
	expect(await findOrderIdByToken(db, old.token)).toBe(old.id);
	expect(await findOrderIdByToken(db, createPublicToken())).toBeNull();
	expect(await findOrderIdByToken(db, String(old.id))).toBeNull();
});

test("the WhatsApp link: the company's number, its text encoded", async () => {
	await setCompanyWhatsApp('573105550142');
	const href = new URL(String(await getWhatsAppHref(db, 'Hola. ¿Y mi pedido #1043?')));
	expect(`${href.origin}${href.pathname}`).toBe('https://wa.me/573105550142');
	expect(href.searchParams.get('text')).toBe('Hola. ¿Y mi pedido #1043?');
	expect(href.search).toBe(`?text=${encodeURIComponent('Hola. ¿Y mi pedido #1043?')}`);
});

test('the terms as stored, empty while there are none', async () => {
	expect(await getClientTerms(db)).toBe('');
	const terms = { text: '## Depósito\n\nSe devuelve al recoger.' };
	expect(await updateTerms(db, terms, MANAGER)).toEqual({ ok: true });
	expect(await getClientTerms(db)).toBe('## Depósito\n\nSe devuelve al recoger.');
});

test('the client sees «Cobrado por novedades», kept from the deposit, apart from Pagado and Saldo', async () => {
	const { id, token } = await create('OUT_FOR_PICKUP');
	await fixture.payment(id, { amount: '500.000' });
	await fixture.payment(id, { concept: 'SECURITY_DEPOSIT', amount: '200.000' });
	const items = [{ product_id: COPA, qty: 10, outcome: 'LOST' }];
	const incident = { order_id: id, incident_description: 'Copas rotas', items };
	expect(await reportIncident(db, incident, DRIVER)).toMatchObject({ ok: true });
	// Kept from the deposit: the charge and its paired «Devolución de depósito».
	await fixture.payment(id, {
		concept: 'DAMAGE_CHARGE',
		amount: '150.000',
		fee_source: 'DEPOSIT',
		description: 'Copas rotas'
	});
	expect(await getPublicOrder(db, token)).toMatchObject({
		paid: 500000,
		balanceDue: 680000,
		depositHeld: 50000,
		damageCharged: 150000
	});
});
