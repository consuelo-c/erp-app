// Logins and sessions, following the design Lucia recommends: a random token in the cookie, its
// SHA-256 as the `sessions` id, so a leaked table hands over no session.

import { z } from 'zod';
import { rolesSchema, type Actor } from '../actor';
import { nowInSeconds } from '../audit';
import { hashPassword, needsRehash, verifyPassword, type PasswordHash } from '../password';

const DAY_SECONDS = 24 * 60 * 60;
export const SESSION_SECONDS = 30 * DAY_SECONDS;
const TOKEN_BYTES = 32;

/** The Worker's secrets: `ADMIN_PASSWORD` is only read while `users` is empty. */
export type AuthSecrets = { pepper: string; adminPassword?: string };

/** Who's knocking, for the LOGIN / LOGIN_FAILED / LOGOUT rows in `events`. */
export type RequestInfo = { ip: string | null; userAgent: string | null };

export type NewSession = { token: string; expiresAt: number };

export type Session = { actor: Actor; expiresAt: number };

type UserRow = {
	id: number;
	username: string;
	password_hash: string;
	password_salt: string;
	password_iterations: number;
	active: number;
};

const credentialsSchema = z.object({
	username: z.string().trim().toLowerCase().min(1),
	password: z.string().min(1)
});

function toHex(buffer: ArrayBuffer | Uint8Array): string {
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sessionIdFor(token: string): Promise<string> {
	return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

function storedHash(user: UserRow): PasswordHash {
	return {
		hash: user.password_hash,
		salt: user.password_salt,
		iterations: user.password_iterations
	};
}

// A failed login has no single row to point at, so its entity_id is null.
function accessEvent(
	db: D1Database,
	action: 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT',
	attempt: RequestInfo & { username: string; userId: number | null }
): D1PreparedStatement {
	return db
		.prepare(
			"insert into events (entity_type, entity_id, action, actor_username, actor_kind, ip, user_agent, created_at) values ('USER', ?, ?, ?, 'user', ?, ?, ?)"
		)
		.bind(attempt.userId, action, attempt.username, attempt.ip, attempt.userAgent, nowInSeconds());
}

// Created by the Worker, not the seed, so the production pepper never leaves Cloudflare. Like the
// seed it writes no events row; `username` being UNIQUE makes a concurrent second attempt a no-op.
async function ensureFirstAdmin(db: D1Database, secrets: AuthSecrets): Promise<void> {
	if (null !== (await db.prepare('select 1 from users limit 1').first())) {
		return;
	}
	if (!secrets.adminPassword) {
		throw new Error('ADMIN_PASSWORD is not set and users is empty');
	}
	const stored = await hashPassword(secrets.adminPassword, secrets.pepper);
	const roles = JSON.stringify(rolesSchema.parse(['ADMIN']));
	const now = nowInSeconds();
	await db
		.prepare(
			"insert into users (username, roles, password_hash, password_salt, password_iterations, created_at, created_by, updated_at, updated_by) values ('admin', ?, ?, ?, ?, ?, 'system', ?, 'system') on conflict (username) do nothing"
		)
		.bind(roles, stored.hash, stored.salt, stored.iterations, now, now)
		.run();
}

// Not an audited edit: the password stays the same, and a hash must never reach `events`.
async function rehashStatement(
	db: D1Database,
	user: UserRow,
	login: { password: string; pepper: string }
) {
	const stored = await hashPassword(login.password, login.pepper);
	return db
		.prepare(
			'update users set password_hash = ?, password_salt = ?, password_iterations = ? where id = ?'
		)
		.bind(stored.hash, stored.salt, stored.iterations, user.id);
}

async function startSession(
	db: D1Database,
	user: UserRow,
	login: RequestInfo & { password: string; pepper: string }
): Promise<NewSession> {
	const token = toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
	const now = nowInSeconds();
	const expiresAt = now + SESSION_SECONDS;
	const statements = [
		db
			.prepare(
				'insert into sessions (id, user_id, expires_at, created_at, created_by, updated_at, updated_by) values (?, ?, ?, ?, ?, ?, ?)'
			)
			.bind(await sessionIdFor(token), user.id, expiresAt, now, user.username, now, user.username),
		accessEvent(db, 'LOGIN', { ...login, username: user.username, userId: user.id })
	];
	if (needsRehash(storedHash(user))) {
		statements.push(await rehashStatement(db, user, login));
	}
	await db.batch(statements);
	return { token, expiresAt };
}

/**
 * Checks the credentials and opens a session. Returns null on any failure, without saying which:
 * an unknown username and a wrong password look the same.
 */
export async function logIn(
	db: D1Database,
	input: unknown,
	context: { secrets: AuthSecrets; request: RequestInfo }
): Promise<NewSession | null> {
	const credentials = credentialsSchema.safeParse(input);
	if (!credentials.success) {
		return null;
	}
	const { username, password } = credentials.data;
	const { pepper } = context.secrets;
	await ensureFirstAdmin(db, context.secrets);
	const user = await db
		.prepare('select * from users where username = ?')
		.bind(username)
		.first<UserRow>();
	const isValid =
		null !== user &&
		1 === user.active &&
		(await verifyPassword(password, pepper, storedHash(user)));
	if (!isValid) {
		await accessEvent(db, 'LOGIN_FAILED', { ...context.request, username, userId: null }).run();
		return null;
	}
	return startSession(db, user, { ...context.request, password, pepper });
}

// Sliding expiration: once less than half the session's life remains, it gets a full 30 days again.
async function renewIfHalfGone(
	db: D1Database,
	sessionId: string,
	session: Session
): Promise<number> {
	const now = nowInSeconds();
	if (session.expiresAt - now >= SESSION_SECONDS / 2) {
		return session.expiresAt;
	}
	const expiresAt = now + SESSION_SECONDS;
	await db
		.prepare('update sessions set expires_at = ?, updated_at = ?, updated_by = ? where id = ?')
		.bind(expiresAt, now, session.actor.username, sessionId)
		.run();
	return expiresAt;
}

/** The session behind a cookie's token, renewed if due; null if it's unknown, expired or inactive. */
export async function validateSession(db: D1Database, token: string): Promise<Session | null> {
	const sessionId = await sessionIdFor(token);
	const row = await db
		.prepare(
			'select sessions.expires_at, users.username, users.roles, users.employee_id from sessions join users on users.id = sessions.user_id where sessions.id = ? and users.active = 1'
		)
		.bind(sessionId)
		.first<{ expires_at: number; username: string; roles: string; employee_id: number | null }>();
	if (null === row) {
		return null;
	}
	if (row.expires_at <= nowInSeconds()) {
		await db.prepare('delete from sessions where id = ?').bind(sessionId).run();
		return null;
	}
	const roles = rolesSchema.parse(JSON.parse(row.roles));
	const actor: Actor = { username: row.username, employeeId: row.employee_id, roles, kind: 'user' };
	const session = { actor, expiresAt: row.expires_at };
	return { actor, expiresAt: await renewIfHalfGone(db, sessionId, session) };
}

/** Deletes the session behind a cookie's token and logs the LOGOUT; an unknown token does nothing. */
export async function logOut(db: D1Database, token: string, request: RequestInfo): Promise<void> {
	const sessionId = await sessionIdFor(token);
	const user = await db
		.prepare(
			'select users.id, users.username from sessions join users on users.id = sessions.user_id where sessions.id = ?'
		)
		.bind(sessionId)
		.first<{ id: number; username: string }>();
	if (null === user) {
		return;
	}
	await db.batch([
		db.prepare('delete from sessions where id = ?').bind(sessionId),
		accessEvent(db, 'LOGOUT', { ...request, username: user.username, userId: user.id })
	]);
}
