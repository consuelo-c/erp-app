import { resolve } from '$app/paths';
import { fetchJson } from '$lib/offline';
import type { LayoutLoad } from './$types';

// The shell needs a session. Without one the endpoint's 401 throws above the shell, so the error
// screen shows no navigation; each page's own requireRole still decides which roles get in.
// Universal, not a server load, so Despachos opens with no network: offline the shell draws with no
// username, and a server load would send it to the root error page instead.
export const load: LayoutLoad = async ({ fetch }) => {
	const session = await fetchJson<{ username: string }>(fetch, resolve('/sesion'));
	return { username: session?.username ?? null };
};
