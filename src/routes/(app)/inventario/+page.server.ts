import { fail } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { hasAnyRole, requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import {
	getSuggestedProducts,
	getUnitsOnRent,
	listCountableProducts,
	submitAndApproveCount,
	submitCount
} from '$lib/server/services/inventory';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.inventoryCount);
	const db = getDb(platform);
	const [suggested, products, onRent] = await Promise.all([
		getSuggestedProducts(db, locals.user),
		listCountableProducts(db, locals.user),
		getUnitsOnRent(db, locals.user)
	]);
	return {
		suggested,
		products,
		onRent,
		canReview: hasAnyRole(locals.user, POLICIES.inventoryReview)
	};
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
		requireRole(locals.user, POLICIES.inventoryCount);
		const db = getDb(platform);
		const items = readPostedItems((await request.formData()).get('items'));
		const result = await submitCount(db, { items }, locals.user);
		return result.ok ? { sentId: result.id, approved: false } : fail(400, result);
	},
	aprobar: async ({ locals, platform, request }) => {
		requireRole(locals.user, POLICIES.inventoryReview);
		const db = getDb(platform);
		const formData = await request.formData();
		const input = { items: readPostedItems(formData.get('items')), note: formData.get('note') };
		const result = await submitAndApproveCount(db, input, locals.user);
		return result.ok ? { sentId: result.id, approved: true } : fail(400, result);
	}
};
