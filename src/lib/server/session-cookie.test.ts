import type { Cookies } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import { SESSION_COOKIE, setSessionCookie } from './session-cookie';

test('the session cookie is httpOnly, secure, sameSite=lax, for the whole site', () => {
	const calls: unknown[][] = [];
	const cookies = { set: (...call: unknown[]) => calls.push(call) } as unknown as Cookies;
	setSessionCookie(cookies, 'token', 1_800_000_000);
	expect(calls).toEqual([
		[
			SESSION_COOKIE,
			'token',
			{
				httpOnly: true,
				secure: true,
				sameSite: 'lax',
				path: '/',
				expires: new Date(1_800_000_000_000)
			}
		]
	]);
});
