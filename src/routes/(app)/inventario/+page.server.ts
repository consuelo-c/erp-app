import { error, fail } from '@sveltejs/kit';
import { isAdminOrManager, requireRole } from '$lib/server/actor';
import {
	getSuggestedProducts,
	getUnitsOnRent,
	listCountableProducts,
	submitAndApproveCount,
	submitCount
} from '$lib/server/services/inventory';
import type { Actions, PageServerLoad } from './$types';

const COUNTS = ['ADMIN', 'MANAGER', 'WAREHOUSE', 'DRIVER'] as const;

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, COUNTS);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const [suggested, products, onRent] = await Promise.all([
		getSuggestedProducts(db, locals.user),
		listCountableProducts(db, locals.user),
		getUnitsOnRent(db, locals.user)
	]);
	return { suggested, products, onRent, canReview: isAdminOrManager(locals.user) };
};

// The rows with a number are a list the browser builds, posted as JSON in one field.
function readPostedItems(value: FormDataEntryValue | null): unknown {
	try {
		return JSON.parse(String(value));
	} catch {
		return null;
	}
}

export const actions: Actions = {
	enviar: async ({ locals, platform, request }) => {
		requireRole(locals.user, COUNTS);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const items = readPostedItems((await request.formData()).get('items'));
		const result = await submitCount(platform.env.DB, { items }, locals.user);
		return result.ok ? { sentId: result.id, approved: false } : fail(400, result);
	},
	aprobar: async ({ locals, platform, request }) => {
		requireRole(locals.user, ['ADMIN', 'MANAGER']);
		if (undefined === platform) {
			error(500, 'Sin acceso a la base de datos');
		}
		const formData = await request.formData();
		const input = { items: readPostedItems(formData.get('items')), note: formData.get('note') };
		const result = await submitAndApproveCount(platform.env.DB, input, locals.user);
		return result.ok ? { sentId: result.id, approved: true } : fail(400, result);
	}
};
