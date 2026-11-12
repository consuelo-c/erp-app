import { expect, test } from 'vitest';
import {
	formatNameAndReach,
	formatWhatsapp,
	normalizeWhatsapp,
	printedContact,
	singleReach,
	whatsappUsernameHref
} from './whatsapp';

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

test("a username's chat link takes it without its @, the case kept", () => {
	expect(whatsappUsernameHref('LuzMarinaR')).toBe('https://wa.me/LuzMarinaR');
});

test('a single link opens the phone when there is one, otherwise the username, or nothing', () => {
	expect(singleReach('573119085512', 'WilsonMudanzas')).toEqual({
		text: '311 908 5512',
		href: 'https://wa.me/573119085512'
	});
	expect(singleReach(null, 'WilsonMudanzas')).toEqual({
		text: '@WilsonMudanzas',
		href: 'https://wa.me/WilsonMudanzas'
	});
	expect(singleReach(null, null)).toBeNull();
});

test('a printout reads the phone, the username when there is no phone, or a blank «Teléfono»', () => {
	expect(printedContact('573104428890', 'mayc47')).toEqual({
		label: 'Teléfono',
		value: '310 442 8890'
	});
	expect(printedContact(null, 'mayc47')).toEqual({ label: 'WhatsApp', value: '@mayc47' });
	expect(printedContact(null, null)).toEqual({ label: 'Teléfono', value: '' });
});
