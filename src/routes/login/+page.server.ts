import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { logIn } from '$lib/server/services/auth';
import { setSessionCookie } from '$lib/server/session-cookie';
import type { Actions } from './$types';

// Public route: no requireRole.
export const actions: Actions = {
	default: async ({ request, platform, cookies, getClientAddress }) => {
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const credentials = Object.fromEntries(await request.formData());
		const session = await logIn(platform.env.DB, credentials, {
			secrets: { pepper: platform.env.PASSWORD_PEPPER, adminPassword: platform.env.ADMIN_PASSWORD },
			request: { ip: getClientAddress(), userAgent: request.headers.get('user-agent') }
		});
		if (null === session) {
			// The username comes back to refill the field; the password never does.
			return fail(400, { username: String(credentials.username ?? ''), invalid: true });
		}
		setSessionCookie(cookies, session.token, session.expiresAt);
		redirect(303, resolve('/despachos'));
	}
};
