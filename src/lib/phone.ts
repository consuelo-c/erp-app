// Phones are stored with their country code, digits only: 573104428890. A foreign number is typed
// with its `+`; without one, the number is Colombian.

const COLOMBIA = '57';

function normalizeInternational(digits: string): string | null {
	if (digits.startsWith(COLOMBIA)) {
		return 12 === digits.length ? digits : null;
	}
	return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function normalizeColombian(digits: string): string | null {
	if (10 === digits.length) {
		return `${COLOMBIA}${digits}`;
	}
	return 12 === digits.length && digits.startsWith(COLOMBIA) ? digits : null;
}

/** A typed phone as stored, or null when it isn't a valid one. The only normalizer: used on save. */
export function normalizePhone(typed: string): string | null {
	const digits = typed.replace(/\D/g, '');
	return typed.trim().startsWith('+') ? normalizeInternational(digits) : normalizeColombian(digits);
}

/** A stored phone as people read it: `310 442 8890`, or `+13055550142` from another country. */
export function formatPhone(phone: string): string {
	if (!phone.startsWith(COLOMBIA)) {
		return `+${phone}`;
	}
	return `${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;
}
