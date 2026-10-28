import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import {
	getLookupWindowStart,
	getWhatsAppHref,
	lookupOrders
} from '$lib/server/services/public-orders';
import { verifyTurnstile } from '$lib/server/turnstile';
import type { Actions, PageServerLoad } from './$types';

const TOO_MANY = 'Demasiados intentos. Espere un minuto e intente de nuevo.';
const NOT_VERIFIED = 'No pudimos verificar la consulta. Intente de nuevo.';
const MISS = 'No encontramos un pedido con ese teléfono y esa fecha.';

// Public: no `requireRole`, and a logged-in employee sees the same as anyone.
export const load: PageServerLoad = async ({ platform }) => {
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return {
		siteKey: platform.env.TURNSTILE_SITE_KEY,
		minDate: getLookupWindowStart(),
		whatsAppHref: await getWhatsAppHref(platform.env.DB, 'Hola. Tengo una duda con mi pedido.')
	};
};

/** What the client typed, sent back to refill the form. */
function typedFields(form: FormData) {
	return {
		phone: String(form.get('phone') ?? ''),
		event_date: String(form.get('event_date') ?? '')
	};
}

/** Why the lookup can't run, or null: the phone and date are guessable, so the rate limit, then Turnstile. */
async function refusal(env: Env, ip: string, token: unknown) {
	const { success: withinLimit } = await env.LOOKUP_RATE_LIMIT.limit({ key: ip });
	if (!withinLimit) {
		return { status: 429, message: TOO_MANY };
	}
	if (!(await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip))) {
		return { status: 400, message: NOT_VERIFIED };
	}
	return null;
}

// Only then the query. Nothing is written and no cookie is set: the lookup isn't a login.
export const actions: Actions = {
	default: async ({ request, platform, getClientAddress }) => {
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const form = await request.formData();
		const typed = typedFields(form);
		const ip = request.headers.get('CF-Connecting-IP') ?? getClientAddress();
		const refused = await refusal(platform.env, ip, form.get('cf-turnstile-response'));
		if (null !== refused) {
			return fail(refused.status, { ...typed, message: refused.message });
		}
		const result = await lookupOrders(platform.env.DB, typed);
		if (!result.ok) {
			return fail(400, { ...typed, errors: result.errors });
		}
		const { matches } = result;
		if (0 === matches.length) {
			return fail(404, { ...typed, message: MISS });
		}
		if (1 === matches.length) {
			redirect(303, resolve('/mi-pedido/[token]', { token: matches[0].token }));
		}
		return { ...typed, matches };
	}
};
