import { createHmac, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { expect, test } from 'vitest';
import { hashPassword, needsRehash, PASSWORD_ITERATIONS, verifyPassword } from './password';

// Workers adds timingSafeEqual to crypto.subtle; Node doesn't, so the tests lend it node:crypto's.
Object.assign(crypto.subtle, { timingSafeEqual });

const PEPPER = 'test-pepper';

test('the hash is PBKDF2-SHA512 over HMAC-SHA512(pepper, password), with a 16-byte salt', async () => {
	const stored = await hashPassword('secreto', PEPPER);
	const salt = Buffer.from(stored.salt, 'base64');
	const peppered = createHmac('sha512', PEPPER).update('secreto').digest();
	const expected = pbkdf2Sync(peppered, salt, PASSWORD_ITERATIONS, 64, 'sha512');
	expect(salt).toHaveLength(16);
	expect(stored.iterations).toBe(PASSWORD_ITERATIONS);
	expect(stored.hash).toBe(expected.toString('base64'));
});

test('each hash gets its own salt', async () => {
	const first = await hashPassword('secreto', PEPPER, 1);
	const second = await hashPassword('secreto', PEPPER, 1);
	expect(first.salt).not.toBe(second.salt);
	expect(first.hash).not.toBe(second.hash);
});

test('only the right password with the right pepper verifies', async () => {
	const stored = await hashPassword('secreto', PEPPER, 1);
	expect(await verifyPassword('secreto', PEPPER, stored)).toBe(true);
	expect(await verifyPassword('Secreto', PEPPER, stored)).toBe(false);
	expect(await verifyPassword('secreto', 'other-pepper', stored)).toBe(false);
});

test('a hash with a lower count still verifies and asks to be re-hashed with the current one', async () => {
	const old = await hashPassword('secreto', PEPPER, 1000);
	expect(await verifyPassword('secreto', PEPPER, old)).toBe(true);
	expect(needsRehash(old)).toBe(true);
	const rehashed = await hashPassword('secreto', PEPPER);
	expect(await verifyPassword('secreto', PEPPER, rehashed)).toBe(true);
	expect(needsRehash(rehashed)).toBe(false);
});
