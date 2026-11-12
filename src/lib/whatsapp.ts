// A WhatsApp username, such as @mayc47, stands next to the phone, never in its place. It's stored
// without the `@`, the case as typed, and shown with it. WhatsApp ignores case, and so does every
// comparison: `CarlosCastro` and `carloscastro` are one username. It's no key: it identifies no one.

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
