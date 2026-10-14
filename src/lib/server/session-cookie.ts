import type { Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = 'session';

/** The cookie holds the token itself; the `sessions` table only its SHA-256. */
export function setSessionCookie(cookies: Cookies, token: string, expiresAt: number): void {
	cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		path: '/',
		expires: new Date(expiresAt * 1000)
	});
}

export function deleteSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
