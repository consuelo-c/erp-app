import type { Handle } from '@sveltejs/kit';
import { validateSession } from '$lib/server/services/auth';
import { deleteSessionCookie, SESSION_COOKIE, setSessionCookie } from '$lib/server/session-cookie';

// Resolves the session cookie into `locals.user`. Who may see what is each route's `requireRole`.
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	const token = event.cookies.get(SESSION_COOKIE);
	if (undefined === token || undefined === event.platform) {
		return resolve(event);
	}
	const session = await validateSession(event.platform.env.DB, token);
	if (null === session) {
		deleteSessionCookie(event.cookies);
	} else {
		event.locals.user = session.actor;
		// Re-set on every request so a renewed expires_at reaches the browser too.
		setSessionCookie(event.cookies, token, session.expiresAt);
	}
	return resolve(event);
};
