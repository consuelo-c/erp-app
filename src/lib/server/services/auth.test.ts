import { createHash, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Role } from '../actor';
import { ADMIN, createFixture, TEST_PASSWORD, TEST_PEPPER } from '../db/fixture';
import { logIn, logOut, SESSION_SECONDS, validateSession } from './auth';
import { deactivateLogin } from './logins';

// Workers adds timingSafeEqual to crypto.subtle; Node doesn't, so the tests lend it node:crypto's.
Object.assign(crypto.subtle, { timingSafeEqual });

const secrets = { pepper: TEST_PEPPER, adminPassword: 'clave-admin' };
const request = { ip: '203.0.113.7', userAgent: 'Prueba/1.0' };
const DAY = 24 * 60 * 60;

let fixture: ReturnType<typeof createFixture>;
let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	fixture = createFixture();
	({ db, database } = fixture);
});

afterEach(() => {
	vi.useRealTimers();
});

function attempt(username: string, password: string) {
	return logIn(db, { username, password }, { secrets, request });
}

// A login of a real employee, with the fixture's password.
function addUser(username: string, roles: Role[] = ['SALES']) {
	return fixture.employee({ roles, username });
}

function loginIdOf(username: string): number {
	return Number(database.prepare('select id from users where username = ?').get(username)?.id);
}

function now() {
	return Math.floor(Date.now() / 1000);
}

test('the first attempt on an empty users creates admin, once, from ADMIN_PASSWORD', async () => {
	expect(await attempt('admin', 'otra')).toBeNull();
	expect(await attempt('admin', 'clave-admin')).not.toBeNull();
	const users = database.prepare('select * from users').all();
	expect(users).toHaveLength(1);
	expect(users[0]).toMatchObject({ username: 'admin', roles: '["ADMIN"]', employee_id: null });
	expect(users[0]).toMatchObject({ created_by: 'system', updated_by: 'system' });
	const actions = database.prepare('select action from events order by id').all();
	expect(actions.map((row) => row.action)).toEqual(['LOGIN_FAILED', 'LOGIN']);
});

test('admin is created even when other logins exist, and never again once it does', async () => {
	const bodega = await addUser('bodega', ['ADMIN']);
	expect(await attempt('admin', 'clave-admin')).not.toBeNull();
	expect((await deactivateLogin(db, { id: loginIdOf('admin') }, bodega)).ok).toBe(true);
	expect(await attempt('admin', 'clave-admin')).toBeNull();
	const usernames = database.prepare('select username from users order by id').all();
	expect(usernames.map((row) => row.username)).toEqual(['bodega', 'admin']);
});

test('the username is matched in lowercase', async () => {
	await addUser('bodega');
	expect(await attempt('  Bodega ', TEST_PASSWORD)).not.toBeNull();
});

test('an unknown username and a wrong password fail alike, each logging LOGIN_FAILED', async () => {
	await addUser('bodega');
	expect(await attempt('nadie', TEST_PASSWORD)).toBeNull();
	expect(await attempt('bodega', 'mala')).toBeNull();
	const failures = database.prepare("select * from events where action = 'LOGIN_FAILED'").all();
	expect(failures).toHaveLength(2);
	expect(failures[0]).toMatchObject({ actor_username: 'nadie', entity_id: null, ip: request.ip });
	expect(failures[1]).toMatchObject({ actor_username: 'bodega', user_agent: request.userAgent });
});

test('an inactive login cannot log in', async () => {
	await addUser('conductor', ['DRIVER']);
	expect((await deactivateLogin(db, { id: loginIdOf('conductor') }, ADMIN)).ok).toBe(true);
	expect(await attempt('conductor', TEST_PASSWORD)).toBeNull();
});

test('the session row holds the SHA-256 of the token and expires in 30 days', async () => {
	await addUser('ventas');
	const session = await attempt('ventas', TEST_PASSWORD);
	const row = database.prepare('select * from sessions').get();
	expect(row?.id).toBe(createHash('sha256').update(session!.token).digest('hex'));
	expect(row?.id).not.toBe(session!.token);
	expect(row?.expires_at).toBe(session!.expiresAt);
	expect(session!.expiresAt - now()).toBeGreaterThanOrEqual(SESSION_SECONDS - 5);
	expect(database.prepare("select * from events where action = 'LOGIN'").get()).toMatchObject({
		actor_username: 'ventas',
		ip: request.ip
	});
});

test('a session renews only once less than half its life remains', async () => {
	const ventas = await addUser('ventas');
	const { token, expiresAt } = (await attempt('ventas', TEST_PASSWORD))!;
	const later = (days: number) =>
		vi.setSystemTime((expiresAt - SESSION_SECONDS + days * DAY) * 1000);

	later(10); // 20 days, more than half its life, remain
	expect((await validateSession(db, token))?.expiresAt).toBe(expiresAt);

	later(20); // 10 days remain
	const renewed = await validateSession(db, token);
	expect(renewed?.expiresAt).toBeGreaterThanOrEqual(now() + SESSION_SECONDS - 5);
	expect(database.prepare('select expires_at from sessions').get()?.expires_at).toBe(
		renewed?.expiresAt
	);
	expect(renewed?.actor).toEqual({
		username: 'ventas',
		employeeId: ventas.employeeId,
		roles: ['SALES'],
		kind: 'user'
	});
});

test('an expired or unknown token gives no session, and the expired row is removed', async () => {
	await addUser('ventas');
	const { token, expiresAt } = (await attempt('ventas', TEST_PASSWORD))!;
	vi.setSystemTime(expiresAt * 1000);
	expect(await validateSession(db, token)).toBeNull();
	expect(database.prepare('select count(*) as count from sessions').get()?.count).toBe(0);
	expect(await validateSession(db, 'not-a-token')).toBeNull();
});

test('logging out deletes the session row and logs LOGOUT; an unknown token does nothing', async () => {
	await addUser('ventas');
	const { token } = (await attempt('ventas', TEST_PASSWORD))!;
	await logOut(db, token, request);
	expect(database.prepare('select count(*) as count from sessions').get()?.count).toBe(0);
	expect(await validateSession(db, token)).toBeNull();
	expect(database.prepare("select * from events where action = 'LOGOUT'").get()).toMatchObject({
		actor_username: 'ventas',
		ip: request.ip,
		user_agent: request.userAgent
	});
	await logOut(db, token, request);
	expect(
		database.prepare("select count(*) as count from events where action = 'LOGOUT'").get()?.count
	).toBe(1);
});
