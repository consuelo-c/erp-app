// PBKDF2-SHA512 through WebCrypto: bcrypt and argon2 are native Node bindings that don't run on Workers.
// 100,000 is the most Workers accepts; it's lowered if login exceeds the free plan's 10 ms of CPU.
// Each hash keeps its own count, so lowering it never breaks the hashes already stored.
export const PASSWORD_ITERATIONS = 100_000;

const SALT_BYTES = 16;
const HASH_BITS = 512;

/** The three `users` columns a password is stored in; hash and salt in base64. */
export interface PasswordHash {
	hash: string;
	salt: string;
	iterations: number;
}

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

// The pepper lives only in the Worker's secrets: a leaked database alone isn't enough to start guessing.
async function pepperPassword(password: string, pepper: string): Promise<ArrayBuffer> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(pepper),
		{ name: 'HMAC', hash: 'SHA-512' },
		false,
		['sign']
	);
	return crypto.subtle.sign('HMAC', key, encoder.encode(password));
}

async function pbkdf2(
	input: ArrayBuffer,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number
): Promise<ArrayBuffer> {
	const key = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits']);
	return crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-512', salt, iterations },
		key,
		HASH_BITS
	);
}

export async function hashPassword(
	password: string,
	pepper: string,
	iterations = PASSWORD_ITERATIONS
): Promise<PasswordHash> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await pbkdf2(await pepperPassword(password, pepper), salt, iterations);
	return { hash: toBase64(new Uint8Array(hash)), salt: toBase64(salt), iterations };
}

// Never ===: an early-exit comparison leaks through its timing how much matched.
function timingSafeEqual(computed: Uint8Array, stored: Uint8Array): boolean {
	if (undefined !== crypto.subtle.timingSafeEqual) {
		return computed.length === stored.length && crypto.subtle.timingSafeEqual(computed, stored);
	}
	// `vite dev` runs the server on Node, which lacks it: the same constant-time comparison by hand.
	let difference = computed.length ^ stored.length;
	for (const [index, byte] of computed.entries()) {
		difference |= byte ^ (stored[index] ?? 0);
	}
	return 0 === difference;
}

export async function verifyPassword(
	password: string,
	pepper: string,
	stored: PasswordHash
): Promise<boolean> {
	const peppered = await pepperPassword(password, pepper);
	const hash = await pbkdf2(peppered, fromBase64(stored.salt), stored.iterations);
	return timingSafeEqual(new Uint8Array(hash), fromBase64(stored.hash));
}

/** A hash made with another count is re-hashed with the current one on the next successful login. */
export function needsRehash(stored: PasswordHash): boolean {
	return PASSWORD_ITERATIONS !== stored.iterations;
}
