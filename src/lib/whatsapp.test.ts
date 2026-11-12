import { expect, test } from 'vitest';
import { formatNameAndReach, formatWhatsapp, normalizeWhatsapp } from './whatsapp';

test.each(['@MayC47', 'MayC47', ' wa.me/MayC47 ', 'https://wa.me/MayC47'])(
	'%s is stored as MayC47, the case kept',
	(typed) => {
		expect(normalizeWhatsapp(typed)).toBe('MayC47');
	}
);

test.each(['may_c.47', 'abc', 'a'.repeat(35)])('%s is accepted', (typed) => {
	expect(normalizeWhatsapp(typed)).toBe(typed);
});

test.each([
	'ab',
	'a'.repeat(36),
	'12345',
	'.mayc',
	'mayc.',
	'may..c',
	'wwwmayc',
	'mayc.com',
	'may-c',
	'',
	'@'
])('%s is rejected', (typed) => {
	expect(normalizeWhatsapp(typed)).toBeNull();
});

test('a username is shown with its @', () => {
	expect(formatWhatsapp('CarlosCastro')).toBe('@CarlosCastro');
});

test('the carrier picker reads the phone, the username when there is no phone, or the name alone', () => {
	expect(formatNameAndReach('Wilson Muñoz', '573119085512', 'WilsonMudanzas')).toBe(
		'Wilson Muñoz · 311 908 5512'
	);
	expect(formatNameAndReach('Wilson Muñoz', null, 'WilsonMudanzas')).toBe(
		'Wilson Muñoz · @WilsonMudanzas'
	);
	expect(formatNameAndReach('Wilson Muñoz', null, null)).toBe('Wilson Muñoz');
});
