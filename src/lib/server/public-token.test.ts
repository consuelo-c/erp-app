import { expect, test } from 'vitest';
import { createPublicToken, publicTokenSchema } from './public-token';

test('a token is 13 characters of base36, lowercase', () => {
	for (let i = 0; i < 200; i++) {
		expect(createPublicToken()).toMatch(/^[0-9a-z]{13}$/);
	}
});

test('tokens differ: 1,000 in a row, no repeat', () => {
	const tokens = new Set(Array.from({ length: 1000 }, createPublicToken));
	expect(tokens.size).toBe(1000);
});

test('the schema takes a token and nothing else: no UUID, no id, no uppercase', () => {
	expect(publicTokenSchema.safeParse(createPublicToken()).success).toBe(true);
	expect(publicTokenSchema.safeParse('o000000001043').success).toBe(true);
	for (const other of [
		crypto.randomUUID(),
		'1043',
		'O000000001043',
		'o00000000104',
		'o0000000010430',
		'o00000000104-',
		undefined,
		1043
	]) {
		expect(publicTokenSchema.safeParse(other).success).toBe(false);
	}
});
