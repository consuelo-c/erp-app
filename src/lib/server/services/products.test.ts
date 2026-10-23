import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Actor, Role } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import {
	createProduct,
	getProduct,
	listProducts,
	listVariantGroups,
	updateProduct
} from './products';

const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
});

const chair = {
	name: 'Silla Tiffany',
	category: 'CHAIRS_TABLES',
	rental_price: '$8.000',
	total_quantity: '120',
	active: 'on'
};

const golden = {
	name: 'Mantel cuadrado 50×50 — Dorado',
	category: 'LINENS',
	new_variant_group: 'Mantel cuadrado 50×50',
	variant_name: 'Dorado',
	rental_price: '9.500',
	total_quantity: '20',
	active: 'on'
};

async function create(input: Record<string, string>): Promise<number> {
	const result = await createProduct(db, input, manager);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.id;
}

function events() {
	return database
		.prepare('select entity_type, action, before, after from events order by id')
		.all();
}

test('creating stores digits only and writes a PRODUCT / CREATED event', async () => {
	const id = await create(chair);
	expect(await getProduct(db, id, manager)).toEqual({
		id,
		name: 'Silla Tiffany',
		category: 'CHAIRS_TABLES',
		variantGroup: null,
		variantName: null,
		description: null,
		rentalPrice: 8000,
		totalQuantity: 120,
		isActive: true
	});
	expect(events()).toMatchObject([{ entity_type: 'PRODUCT', action: 'CREATED', before: null }]);
});

test('editing logs only the changed fields in before/after', async () => {
	const id = await create(chair);
	await updateProduct(db, { ...chair, id, rental_price: '9.000' }, manager);
	const edited = events()[1];
	expect(edited).toMatchObject({ entity_type: 'PRODUCT', action: 'EDITED' });
	expect(JSON.parse(String(edited.before))).toEqual({ rental_price: 8000 });
	expect(JSON.parse(String(edited.after))).toEqual({ rental_price: 9000 });
});

test('Inactivo deactivates the product, which stays in the list', async () => {
	const id = await create(chair);
	await updateProduct(db, { ...chair, id, active: 'off' }, manager);
	expect((await listProducts(db, {}, manager)).products).toMatchObject([{ id, isActive: false }]);
});

test('the picker lists each group once, with its category, and a save says its group', async () => {
	const result = await createProduct(db, golden, manager);
	expect(result).toMatchObject({ ok: true, variantGroup: 'Mantel cuadrado 50×50' });
	const picked = { ...golden, new_variant_group: '', variant_group: 'Mantel cuadrado 50×50' };
	await create({ ...picked, variant_name: 'Rojo' });
	await create(chair);
	expect(await listVariantGroups(db, manager)).toEqual([
		{ name: 'Mantel cuadrado 50×50', category: 'LINENS' }
	]);
});

test('a variant group and a variant name go together', async () => {
	const withoutName = await createProduct(db, { ...golden, variant_name: '' }, manager);
	expect(withoutName).toMatchObject({ ok: false, field: 'variant_name' });
	const withoutGroup = await createProduct(db, { ...golden, new_variant_group: '' }, manager);
	expect(withoutGroup).toMatchObject({ ok: false, field: 'variant_group' });
});

test('a variant already in its group, ignoring case, fails on the UNIQUE index with a message on Variante', async () => {
	await create(golden);
	const picked = { ...golden, new_variant_group: '', variant_group: 'Mantel cuadrado 50×50' };
	const result = await createProduct(db, { ...picked, variant_name: 'DORADO' }, manager);
	expect(result).toEqual({
		ok: false,
		message: 'Esa variante ya existe en el grupo',
		field: 'variant_name'
	});
	expect((await create({ ...picked, variant_name: 'Rojo' })) > 0).toBe(true);
});

test('a new group matching an existing one, ignoring case, must be picked from the list', async () => {
	await create(golden);
	const result = await createProduct(
		db,
		{ ...golden, new_variant_group: 'MANTEL cuadrado 50×50', variant_name: 'Rojo' },
		manager
	);
	expect(result).toMatchObject({ ok: false, field: 'new_variant_group' });
});

test('a picked group that does not exist is rejected', async () => {
	const result = await createProduct(
		db,
		{ ...golden, new_variant_group: '', variant_group: 'Mantel redondo' },
		manager
	);
	expect(result).toMatchObject({ ok: false, field: 'variant_group' });
});

test('the price per day must be above zero; the total quantity may be zero', async () => {
	const free = await createProduct(db, { ...chair, rental_price: '0' }, manager);
	expect(free).toMatchObject({ ok: false, field: 'rental_price' });
	expect((await create({ ...chair, total_quantity: '0' })) > 0).toBe(true);
});

test('SALES lists products but cannot open, create or edit one', async () => {
	const id = await create(chair);
	const sales: Actor = { ...manager, roles: ['SALES'] };
	expect((await listProducts(db, {}, sales)).products).toHaveLength(1);
	const refusals = await Promise.all([
		getProduct(db, id, sales).catch((caught: unknown) => caught),
		createProduct(db, chair, sales).catch((caught: unknown) => caught),
		updateProduct(db, { ...chair, id }, sales).catch((caught: unknown) => caught)
	]);
	for (const refusal of refusals) {
		expect(isHttpError(refusal, 403)).toBe(true);
	}
});

test('WAREHOUSE and DRIVER get a 403 on the list', async () => {
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const actor: Actor = { ...manager, roles: [role] };
		await expect(listProducts(db, {}, actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
});

test('the list narrows by text and category, a group kept whole by any variant', async () => {
	await create(chair);
	await create(golden);
	const red = { name: 'Mantel cuadrado 50×50 — Rojo', variant_name: 'Rojo' };
	await create({
		...golden,
		...red,
		new_variant_group: '',
		variant_group: 'Mantel cuadrado 50×50'
	});
	await create({ ...chair, name: 'Copa cristalería', category: 'GLASSWARE' });
	const names = async (input: Record<string, string>) =>
		(await listProducts(db, input, manager)).products.map(({ name }) => name);
	expect(await names({ search: 'ROJO' })).toEqual([golden.name, red.name]);
	expect(await names({ search: 'cristaleria' })).toEqual(['Copa cristalería']);
	expect(await names({ search: 'silla', category: 'LINENS' })).toEqual([]);
	expect(await names({ category: 'CHAIRS_TABLES' })).toEqual(['Silla Tiffany']);
	// A tampered category is ignored, not an error.
	expect(await names({ category: 'NOPE' })).toHaveLength(4);
});
