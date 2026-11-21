import { z } from 'zod';

// A client link's key, short enough to read in a WhatsApp message: 64 random bits, which no script
// guesses even with no captcha in front of the public pages. 2^64 fits in 13 base36
// characters, padded so every token has the same length.
const TOKEN_BYTES = 8;
const TOKEN_LENGTH = 13;

export function createPublicToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
	const value = bytes.reduce((total, byte) => (total << 8n) | BigInt(byte), 0n);
	return value.toString(36).padStart(TOKEN_LENGTH, '0');
}

/** Only a token's shape: anything else, an order's id or an old UUID included, finds nothing. */
export const publicTokenSchema = z.string().regex(new RegExp(`^[0-9a-z]{${TOKEN_LENGTH}}$`));
