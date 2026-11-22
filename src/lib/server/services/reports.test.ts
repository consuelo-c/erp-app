import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { logIn } from './auth';
import { createContact } from './contacts';
import { createProduct } from './products';
import { getAuditLog } from './reports';

const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };
const admin: Actor = { ...manager, username: 'admin', roles: ['ADMIN'] };
const sales: Actor = { ...manager, username: 'vendedora', roles: ['SALES'] };
const driver: Actor = { ...manager, username: 'conductor1', roles: ['DRIVER'] };

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
});

/** A Bogotá wall-clock time as the epoch seconds `events.created_at` stores. */
function bogota(dateTime: string): number {
	return Date.parse(`${dateTime}-05:00`) / 1000;
}

type Seeded = {
	entityType?: string;
	entityId?: number | null;
	entityKey?: string | null;
	action?: string;
	username?: string;
	before?: Record<string, unknown> | null;
	after?: Record<string, unknown> | null;
	reason?: string | null;
	ip?: string | null;
	userAgent?: string | null;
	at?: string;
};

const DEFAULT_EVENT: Required<Seeded> = {
	entityType: 'ORDER',
	entityId: 1,
	entityKey: null,
	action: 'EDITED',
	username: 'gerente',
	before: null,
	after: { status: 'DELIVERED' },
	reason: null,
	ip: null,
	userAgent: null,
	at: '2026-11-22T10:00:00'
};

function toJson(fields: Record<string, unknown> | null): string | null {
	return null === fields ? null : JSON.stringify(fields);
}

function seed(overrides: Seeded = {}): number {
	const event = { ...DEFAULT_EVENT, ...overrides };
	const result = database
		.prepare(
			`insert into events (entity_type, entity_id, entity_key, action, actor_username, actor_kind,
			before, after, reason, ip, user_agent, created_at) values (?, ?, ?, ?, ?, 'user', ?, ?, ?, ?, ?, ?)`
		)
		.run(
			event.entityType,
			event.entityId,
			event.entityKey,
			event.action,
			event.username,
			toJson(event.before),
			toJson(event.after),
			event.reason,
			event.ip,
			event.userAgent,
			bogota(event.at)
		);
	return Number(result.lastInsertRowid);
}

function idsOf(log: Awaited<ReturnType<typeof getAuditLog>>): number[] {
	return log.events.map((event) => event.id);
}

async function refusal(actor: Actor): Promise<number | null> {
	try {
		await getAuditLog(db, {}, actor);
		return null;
	} catch (thrown) {
		return isHttpError(thrown) ? thrown.status : null;
	}
}

describe('getAuditLog', () => {
	test('lists the Events newest first, the latest of the same second on top', async () => {
		const older = seed({ at: '2026-11-21T09:00:00' });
		const sameSecondFirst = seed({ at: '2026-11-22T10:00:00' });
		const sameSecondLast = seed({ at: '2026-11-22T10:00:00' });
		const newest = seed({ at: '2026-11-22T11:30:00' });

		const log = await getAuditLog(db, {}, manager);

		expect(idsOf(log)).toEqual([newest, sameSecondLast, sameSecondFirst, older]);
	});

	test('pages 20 at a time, with the total and the page count', async () => {
		for (let minute = 0; minute < 45; minute++) {
			seed({ at: `2026-11-22T10:${String(minute).padStart(2, '0')}:00` });
		}

		const first = await getAuditLog(db, {}, manager);
		const third = await getAuditLog(db, { page: '3' }, admin);

		expect(first).toMatchObject({ total: 45, pageCount: 3, filters: { page: 1 } });
		expect(first.events).toHaveLength(20);
		expect(third.events).toHaveLength(5);
		expect(third.filters.page).toBe(3);
	});

	test('a page past the last shows the last, and an unreadable one the first', async () => {
		seed();

		expect((await getAuditLog(db, { page: '9' }, manager)).filters.page).toBe(1);
		expect((await getAuditLog(db, { page: 'dos' }, manager)).filters.page).toBe(1);
	});

	test('with no Events the page is empty, one page long', async () => {
		const log = await getAuditLog(db, {}, manager);

		expect(log).toMatchObject({ events: [], total: 0, pageCount: 1 });
	});

	test('Desde and Hasta are inclusive Bogotá days: 11 p.m. belongs to its own day', async () => {
		const lateOnTheTwentieth = seed({ at: '2026-11-20T23:59:00' });
		const earlyOnTheTwentyFirst = seed({ at: '2026-11-21T00:00:00' });
		const lateOnTheTwentyFirst = seed({ at: '2026-11-21T23:00:00' });
		const onTheTwentySecond = seed({ at: '2026-11-22T00:30:00' });

		const oneDay = await getAuditLog(db, { from: '2026-11-21', to: '2026-11-21' }, manager);
		const fromOnly = await getAuditLog(db, { from: '2026-11-21' }, manager);
		const toOnly = await getAuditLog(db, { to: '2026-11-20' }, manager);

		expect(idsOf(oneDay)).toEqual([lateOnTheTwentyFirst, earlyOnTheTwentyFirst]);
		expect(idsOf(fromOnly)).toEqual([
			onTheTwentySecond,
			lateOnTheTwentyFirst,
			earlyOnTheTwentyFirst
		]);
		expect(idsOf(toOnly)).toEqual([lateOnTheTwentieth]);
	});

	test('filters by the exact username', async () => {
		const byDriver = seed({ username: 'conductor1' });
		seed({ username: 'conductor10' });
		seed({ username: 'gerente' });

		const log = await getAuditLog(db, { username: 'conductor1' }, manager);

		expect(idsOf(log)).toEqual([byDriver]);
	});

	test('filters by Registro and by Acción, alone and combined with every other filter', async () => {
		const productEdit = seed({
			entityType: 'PRODUCT',
			action: 'EDITED',
			at: '2026-11-21T08:00:00'
		});
		const productCreated = seed({ entityType: 'PRODUCT', action: 'CREATED' });
		const orderEdit = seed({ entityType: 'ORDER', action: 'EDITED' });
		seed({ entityType: 'PRODUCT', action: 'EDITED', username: 'admin' });

		const products = await getAuditLog(db, { entityType: 'PRODUCT' }, manager);
		const edits = await getAuditLog(db, { action: 'EDITED' }, manager);
		const combined = await getAuditLog(
			db,
			{
				from: '2026-11-21',
				to: '2026-11-21',
				username: 'gerente',
				entityType: 'PRODUCT',
				action: 'EDITED'
			},
			manager
		);

		expect(idsOf(products)).toHaveLength(3);
		expect(idsOf(products)).toContain(productCreated);
		expect(idsOf(edits)).toHaveLength(3);
		expect(idsOf(edits)).toContain(orderEdit);
		expect(idsOf(combined)).toEqual([productEdit]);
	});

	test('a combination with no Events is an empty page, not a refusal', async () => {
		seed({ entityType: 'SETTINGS', entityId: null, entityKey: 'orders_deposit_percent' });

		const log = await getAuditLog(db, { entityType: 'SETTINGS', action: 'LOGIN' }, manager);

		expect(log).toMatchObject({ events: [], total: 0 });
	});

	test('unreadable filter values fall back to «all»', async () => {
		seed();
		seed({ entityType: 'PRODUCT', action: 'CREATED' });

		const log = await getAuditLog(
			db,
			{ from: '21/11/2026', to: 'ayer', entityType: 'PEDIDO', action: 'BORRADO', username: '' },
			manager
		);

		expect(log.total).toBe(2);
		expect(log.filters).toMatchObject({
			from: undefined,
			to: undefined,
			entityType: undefined,
			action: undefined,
			username: undefined
		});
	});

	test('«Usuario» lists every username in the log, sorted, logins or not', async () => {
		seed({ username: 'vendedora' });
		seed({ username: 'jperez', entityType: 'USER', entityId: null, action: 'LOGIN_FAILED' });
		seed({ username: 'system' });
		seed({ username: 'vendedora' });
		seed({ username: 'conductor1', at: '2026-01-02T08:00:00' });

		const log = await getAuditLog(db, { username: 'system' }, manager);

		expect(log.usernames).toEqual(['conductor1', 'jperez', 'system', 'vendedora']);
	});

	test('each changed field is a column with its raw value before and after', async () => {
		seed({
			entityType: 'PRODUCT',
			before: { rental_price: 2500, 'attributes.replacement_cost': null },
			after: { rental_price: 2800, 'attributes.replacement_cost': 95000 }
		});
		seed({
			entityType: 'CASH_MOVEMENT',
			action: 'CREATED',
			before: null,
			after: { concept: 'INSTALLMENT', amount: 680000 },
			at: '2026-11-21T10:00:00'
		});

		const [edit, creation] = (await getAuditLog(db, {}, manager)).events;

		expect(edit.changes).toEqual([
			{ column: 'rental_price', before: 2500, after: 2800 },
			{ column: 'attributes.replacement_cost', before: null, after: 95000 }
		]);
		expect(creation.changes).toEqual([
			{ column: 'concept', before: null, after: 'INSTALLMENT' },
			{ column: 'amount', before: null, after: 680000 }
		]);
	});

	test('an Event carries its reason, and an access Event its IP and browser', async () => {
		seed({ action: 'CANCELLED', reason: 'El cliente canceló el evento' });
		const secrets = { pepper: 'test-pepper', adminPassword: 'clave-admin' };
		const request = { ip: '181.59.204.17', userAgent: 'Mozilla/5.0 (Linux; Android 14)' };
		await logIn(db, { username: 'admin', password: 'clave-admin' }, { secrets, request });

		const events = (await getAuditLog(db, {}, manager)).events;
		const login = events.find((event) => 'LOGIN' === event.action);
		const cancellation = events.find((event) => 'CANCELLED' === event.action);

		expect(cancellation).toMatchObject({ reason: 'El cliente canceló el evento', ip: null });
		expect(login).toMatchObject({
			username: 'admin',
			entityType: 'USER',
			ip: '181.59.204.17',
			userAgent: 'Mozilla/5.0 (Linux; Android 14)',
			changes: [],
			link: { href: '/logins/1', label: 'admin' }
		});
	});

	test('a record with a page links to it, readably where cheap; the rest link nowhere', async () => {
		const product = await createProduct(
			db,
			{
				name: 'Silla Tiffany dorada',
				category: 'CHAIRS_TABLES',
				rental_price: '2.500',
				total_quantity: '120',
				active: 'on'
			},
			manager
		);
		const contact = await createContact(
			db,
			{ full_name: 'Luz Marina Restrepo', phone: '3104428890', document_id: '43210987' },
			manager
		);
		if (!product.ok || !contact.ok) {
			throw new Error('seeding failed');
		}
		seed({ entityType: 'ORDER', entityId: 1061 });
		seed({ entityType: 'QUOTE', entityId: 12 });
		seed({ entityType: 'RECEIVABLE', entityId: 4 });
		seed({ entityType: 'INVENTORY_COUNT', entityId: 3 });
		seed({ entityType: 'EMPLOYEE', entityId: 99 });
		seed({ entityType: 'CASH_MOVEMENT', entityId: 316 });
		seed({ entityType: 'TIMESHEET', entityId: 8 });
		seed({ entityType: 'SETTINGS', entityId: null, entityKey: 'orders_deposit_percent' });
		seed({ entityType: 'USER', entityId: null, action: 'LOGIN_FAILED', username: 'jperez' });

		const events = (await getAuditLog(db, {}, manager)).events;
		const linkOf = (type: string) => events.find((event) => type === event.entityType)?.link;

		expect(linkOf('PRODUCT')).toEqual({
			href: `/productos/${product.id}`,
			label: 'Silla Tiffany dorada'
		});
		expect(linkOf('CONTACT')).toEqual({
			href: `/contactos/${contact.id}`,
			label: 'Luz Marina Restrepo'
		});
		expect(linkOf('ORDER')).toEqual({ href: '/pedidos/1061', label: '#1061' });
		expect(linkOf('QUOTE')).toEqual({ href: '/cotizaciones/12', label: 'Cotización #12' });
		expect(linkOf('RECEIVABLE')).toEqual({ href: '/cuentas-de-cobro/4', label: 'CC Nº 4' });
		expect(linkOf('INVENTORY_COUNT')).toEqual({ href: '/inventario/revisar/3', label: '3' });
		// An employee id whose row is gone still links, under its plain id.
		expect(linkOf('EMPLOYEE')).toEqual({ href: '/personal/99', label: '99' });
		expect(linkOf('CASH_MOVEMENT')).toBeNull();
		expect(linkOf('TIMESHEET')).toBeNull();
		expect(linkOf('SETTINGS')).toBeNull();
		expect(linkOf('USER')).toBeNull();
	});

	test('reads, never writes: no Event is added by reading the log', async () => {
		seed();

		await getAuditLog(db, {}, manager);

		expect(database.prepare('select count(*) as count from events').get()).toEqual({ count: 1 });
	});

	test('only managers read it: Sales, drivers and warehouse are refused', async () => {
		expect(await refusal(sales)).toBe(403);
		expect(await refusal(driver)).toBe(403);
		expect(await refusal({ ...manager, roles: ['WAREHOUSE'] })).toBe(403);
		expect(await refusal(admin)).toBeNull();
	});
});
