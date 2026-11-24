import type { DatabaseSync } from 'node:sqlite';
import { isRedirect } from '@sveltejs/kit';
import { beforeEach, expect, test } from 'vitest';
import { createMemoryD1 } from '$lib/server/db/memory-d1';
import * as landing from './+page.server';

const AUDIT = "0, 'admin', 0, 'admin'";

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
});

const load = (user: unknown = null) =>
	landing.load({ platform: { env: { DB: db } }, locals: { user } } as never);

test('a logged-in employee opening the landing goes to Despachos', async () => {
	const thrown = await Promise.resolve(load({ username: 'ana', roles: ['DISPATCHER'] })).catch(
		(error: unknown) => error
	);
	expect(isRedirect(thrown)).toBe(true);
	expect(thrown).toMatchObject({ location: '/despachos' });
});

test("the landing's WhatsApp carries no order", async () => {
	database.exec(
		`insert into settings (key, value, created_at, created_by, updated_at, updated_by) values ('COMPANY_WHATSAPP', '573105550142', ${AUDIT})`
	);
	const href = new URL(String((await load())?.whatsAppHref));
	expect(href.pathname).toBe('/573105550142');
	expect(href.searchParams.get('text')).toBe('Hola. Tengo una duda con mi pedido.');
});

test('the landing takes no form: no actions', () => {
	expect('actions' in landing).toBe(false);
});
