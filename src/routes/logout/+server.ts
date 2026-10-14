import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireRole, ROLES } from '$lib/server/actor';
import { logOut } from '$lib/server/services/auth';
import { deleteSessionCookie, SESSION_COOKIE } from '$lib/server/session-cookie';
import type { RequestHandler } from './$types';

// Deletes the sessions row, not just the cookie: a copied cookie stops working too.
export const POST: RequestHandler = async ({
	locals,
	cookies,
	platform,
	request,
	getClientAddress
}) => {
	requireRole(locals.user, ROLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	// The hook only sets locals.user from a valid cookie, so the token is here.
	await logOut(platform.env.DB, cookies.get(SESSION_COOKIE) ?? '', {
		ip: getClientAddress(),
		userAgent: request.headers.get('user-agent')
	});
	deleteSessionCookie(cookies);
	redirect(303, resolve('/login'));
};
