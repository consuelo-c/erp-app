import { createHash, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import { createMemoryD1 } from '../db/memory-d1';
import { hashPassword, PASSWORD_ITERATIONS } from '../password';
import { logIn, logOut, SESSION_SECONDS, validateSession } from './auth';

// Workers adds timingSafeEqual to crypto.subtle; Node doesn't, so the tests lend it node:crypto's.
Object.assign(crypto.subtle, { timingSafeEqual });

const secrets = { pepper: 'test-pepper', adminPassword: 'clave-admin' };
const request = { ip: '203.0.113.7', userAgent: 'Prueba/1.0' };
const DAY = 24 * 60 * 60;

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
});

function attempt(username: string, password: string) {
	return logIn(db, { username, password }, { secrets, request });
}

async function addUser(username: string, options: { active?: number; iterations?: number } = {}) {
	const stored = await hashPassword('clave', secrets.pepper, options.iterations);
	database
		.prepare(
			`insert into users (username, roles, password_hash, password_salt, password_iterations, active, created_at, created_by, updated_at, updated_by) values (?, '["SALES"]', ?, ?, ?, ?, 0, 'admin', 0, 'admin')`
		)
		.run(username, stored.hash, stored.salt, stored.iterations, options.active ?? 1);
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

test('the username is matched in lowercase', async () => {
	await addUser('bodega');
	expect(await attempt('  Bodega ', 'clave')).not.toBeNull();
});

test('an unknown username and a wrong password fail alike, each logging LOGIN_FAILED', async () => {
	await addUser('bodega');
	expect(await attempt('nadie', 'clave')).toBeNull();
	expect(await attempt('bodega', 'mala')).toBeNull();
	const failures = database.prepare("select * from events where action = 'LOGIN_FAILED'").all();
	expect(failures).toHaveLength(2);
	expect(failures[0]).toMatchObject({ actor_username: 'nadie', entity_id: null, ip: request.ip });
	expect(failures[1]).toMatchObject({ actor_username: 'bodega', user_agent: request.userAgent });
});

test('an inactive login cannot log in', async () => {
	await addUser('conductor', { active: 0 });
	expect(await attempt('conductor', 'clave')).toBeNull();
});

test('the session row holds the SHA-256 of the token and expires in 30 days', async () => {
	await addUser('ventas');
	const session = await attempt('ventas', 'clave');
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

test('a successful login re-hashes a password stored with a lower iteration count', async () => {
	await addUser('gerente', { iterations: 1000 });
	expect(await attempt('gerente', 'clave')).not.toBeNull();
	const row = database.prepare('select password_iterations from users').get();
	expect(row?.password_iterations).toBe(PASSWORD_ITERATIONS);
	expect(await attempt('gerente', 'clave')).not.toBeNull();
});

test('a session renews only once less than half its life remains', async () => {
	await addUser('ventas');
	const { token } = (await attempt('ventas', 'clave'))!;
	const setExpiry = (seconds: number) =>
		database.prepare('update sessions set expires_at = ?').run(seconds);

	const halfLifeLeft = now() + 20 * DAY;
	setExpiry(halfLifeLeft);
	expect((await validateSession(db, token))?.expiresAt).toBe(halfLifeLeft);

	setExpiry(now() + 10 * DAY);
	const renewed = await validateSession(db, token);
	expect(renewed?.expiresAt).toBeGreaterThanOrEqual(now() + SESSION_SECONDS - 5);
	expect(database.prepare('select expires_at from sessions').get()?.expires_at).toBe(
		renewed?.expiresAt
	);
	expect(renewed?.actor).toEqual({
		username: 'ventas',
		employeeId: null,
		roles: ['SALES'],
		kind: 'user'
	});
});

test('an expired or unknown token gives no session, and the expired row is removed', async () => {
	await addUser('ventas');
	const { token } = (await attempt('ventas', 'clave'))!;
	database.prepare('update sessions set expires_at = ?').run(now() - 1);
	expect(await validateSession(db, token)).toBeNull();
	expect(database.prepare('select count(*) as count from sessions').get()?.count).toBe(0);
	expect(await validateSession(db, 'not-a-token')).toBeNull();
});

test('logging out deletes the session row and logs LOGOUT; an unknown token does nothing', async () => {
	await addUser('ventas');
	const { token } = (await attempt('ventas', 'clave'))!;
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
