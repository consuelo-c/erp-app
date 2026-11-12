// A WhatsApp username, such as @mayc47, stands next to the phone, never in its place. It's stored
// without the `@`, the case as typed, and shown with it. WhatsApp ignores case, and so does every
// comparison: `CarlosCastro` and `carloscastro` are one username. It's no key: it identifies no one.

import { formatPhone } from './phone';

export const INVALID_WHATSAPP = 'Escriba el usuario como aparece en WhatsApp, por ejemplo @mayc47.';

// WhatsApp's own rules: 3 to 35 English letters, digits, `.` and `_`, at least one letter.
const SHAPE = /^(?=.*[A-Za-z])[A-Za-z0-9._]{3,35}$/;
const DOMAIN_ENDING = /\.(com|org|net|edu|gov|html|txt)$/i;

// What people paste: the bare username, with its `@`, or WhatsApp's link to it.
const PREFIX = /^(?:(?:https?:\/\/)?wa\.me\/)?@?/i;

/** A typed username as stored, or null when it isn't a valid one. The only normalizer: on save. */
export function normalizeWhatsapp(typed: string): string | null {
	const username = typed.trim().replace(PREFIX, '');
	const isValid =
		SHAPE.test(username) &&
		!username.startsWith('.') &&
		!username.endsWith('.') &&
		!username.includes('..') &&
		!/^www/i.test(username) &&
		!DOMAIN_ENDING.test(username);
	return isValid ? username : null;
}

/** A stored username as people read it: always with its `@`. */
export function formatWhatsapp(username: string): string {
	return `@${username}`;
}

/**
 * A person as a picker lists them: the name and the phone, or the username when there's no phone,
 * or the name alone with neither. «Wilson Muñoz · @WilsonMudanzas».
 */
export function formatNameAndReach(
	name: string,
	phone: string | null,
	username: string | null
): string {
	if (null !== phone) {
		return `${name} · ${formatPhone(phone)}`;
	}
	return null === username ? name : `${name} · ${formatWhatsapp(username)}`;
}

/** The `wa.me` chat with a username: without its `@`, the form WhatsApp documents. */
export function whatsappUsernameHref(username: string): string {
	return `https://wa.me/${username}`;
}

/**
 * A carrier's single link, on Despachos and the details' carrier line: the phone when there's one,
 * otherwise the username, both to `wa.me`; null with neither. What it reads goes with it.
 */
export function singleReach(
	phone: string | null,
	username: string | null
): { text: string; href: string } | null {
	if (null !== phone) {
		return { text: formatPhone(phone), href: `https://wa.me/${phone}` };
	}
	return null === username
		? null
		: { text: formatWhatsapp(username), href: whatsappUsernameHref(username) };
}

/**
 * The printouts' one contact line: «Teléfono» with the phone, even when there's a username too;
 * «WhatsApp» with the username when there's only that; «Teléfono» blank with neither, written in
 * by hand.
 */
export function printedContact(
	phone: string | null,
	username: string | null
): { label: string; value: string } {
	if (null === phone && null !== username) {
		return { label: 'WhatsApp', value: formatWhatsapp(username) };
	}
	return { label: 'Teléfono', value: formatPhone(phone) };
}
