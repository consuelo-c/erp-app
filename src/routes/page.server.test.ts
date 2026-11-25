import { isRedirect } from '@sveltejs/kit';
import { beforeEach, expect, test } from 'vitest';
import { createFixture, DRIVER, MANAGER } from '$lib/server/db/fixture';
import { getSystemSettings, updateSystemSettings } from '$lib/server/services/settings';
import * as landing from './+page.server';

let db: D1Database;

beforeEach(() => {
	({ db } = createFixture());
});

const load = (user: unknown = null) =>
	landing.load({ platform: { env: { DB: db } }, locals: { user } } as never);

test('a logged-in employee opening the landing goes to Despachos', async () => {
	const thrown = await Promise.resolve(load(DRIVER)).catch((error: unknown) => error);
	expect(isRedirect(thrown)).toBe(true);
	expect(thrown).toMatchObject({ location: '/despachos' });
});

test("the landing's WhatsApp carries no order", async () => {
	const values = await getSystemSettings(db, ['COMPANY'], MANAGER);
	const form = { ...values, COMPANY_WHATSAPP: '573105550142' };
	expect(await updateSystemSettings(db, { modules: ['COMPANY'], values: form }, MANAGER)).toEqual({
		ok: true
	});
	const href = new URL(String((await load())?.whatsAppHref));
	expect(href.pathname).toBe('/573105550142');
	expect(href.searchParams.get('text')).toBe('Hola. Tengo una duda con mi pedido.');
});

test('the landing takes no form: no actions', () => {
	expect('actions' in landing).toBe(false);
});
