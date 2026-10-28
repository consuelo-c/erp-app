import { z } from 'zod';

// Cloudflare Turnstile, checked on the server with a plain `fetch`: no library.
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const SITEVERIFY_TIMEOUT_MS = 5000;

const siteverifySchema = z.object({ success: z.boolean() });

/**
 * Whether Cloudflare vouches for the widget's token. A missing token, a refusal, or a
 * `siteverify` that doesn't answer is a no, never a pass.
 */
export async function verifyTurnstile(
	token: unknown,
	secret: string,
	ip: string
): Promise<boolean> {
	if ('string' !== typeof token || '' === token) {
		return false;
	}
	try {
		const response = await fetch(SITEVERIFY_URL, {
			method: 'POST',
			body: new URLSearchParams({ secret, response: token, remoteip: ip }),
			signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS)
		});
		const answer = siteverifySchema.safeParse(await response.json());
		return answer.success && answer.data.success;
	} catch {
		return false;
	}
}
