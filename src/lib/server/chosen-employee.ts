import type { Cookies } from '@sveltejs/kit';

// ADMIN and MANAGER pick an employee in Horas › Empleado and in Nómina. The last one picked is
// remembered, so going from one screen to the other keeps the same person on screen: settling
// someone else's hours is the mistake to rule out. Until the browser closes; the services still
// check every id.
const CHOSEN_EMPLOYEE_COOKIE = 'chosen_employee';

/** `?empleado=` when the URL names one, remembered from then on; otherwise the last one picked. */
export function rememberEmployee(url: URL, cookies: Cookies): string | null {
	const chosen = url.searchParams.get('empleado');
	if (null === chosen) {
		return cookies.get(CHOSEN_EMPLOYEE_COOKIE) ?? null;
	}
	cookies.set(CHOSEN_EMPLOYEE_COOKIE, chosen, {
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		path: '/'
	});
	return chosen;
}
