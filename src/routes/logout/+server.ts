import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { forgetFilters } from '$lib/server/list-filters';
import { getDb } from '$lib/server/platform';
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
	requireRole(locals.user, POLICIES.anyLogin);
	const db = getDb(platform);
	// The hook only sets locals.user from a valid cookie, so the token is here.
	await logOut(db, cookies.get(SESSION_COOKIE) ?? '', {
		ip: getClientAddress(),
		userAgent: request.headers.get('user-agent')
	});
	deleteSessionCookie(cookies);
	forgetFilters(cookies);
	redirect(303, resolve('/login'));
};
