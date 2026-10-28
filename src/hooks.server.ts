import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { Actor } from '$lib/server/actor';
import { validateSession } from '$lib/server/services/auth';
import { deleteSessionCookie, SESSION_COOKIE, setSessionCookie } from '$lib/server/session-cookie';

const CLIENT_ROUTES = new Set(['/', '/mi-pedido/[token]']);

async function resolveUser(event: RequestEvent): Promise<Actor | null> {
	const token = event.cookies.get(SESSION_COOKIE);
	if (undefined === token || undefined === event.platform) {
		return null;
	}
	const session = await validateSession(event.platform.env.DB, token);
	if (null === session) {
		deleteSessionCookie(event.cookies);
		return null;
	}
	// Re-set on every request so a renewed expires_at reaches the browser too.
	setSessionCookie(event.cookies, token, session.expiresAt);
	return session.actor;
}

// Resolves the session cookie into `locals.user`. Who may see what is each route's `requireRole`.
// The client's pages, their 404 and redirects included: the token never travels in a `Referer`,
// and nothing indexes or keeps them.
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await resolveUser(event);
	const response = await resolve(event);
	if (CLIENT_ROUTES.has(event.route.id ?? '')) {
		response.headers.set('Referrer-Policy', 'no-referrer');
		response.headers.set('X-Robots-Tag', 'noindex');
		response.headers.set('Cache-Control', 'private, no-store');
	}
	return response;
};
