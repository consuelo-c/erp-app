import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createFixture, DRIVER, MANAGER, SALES, WAREHOUSE } from '../db/fixture';
import { submitAndApproveCount } from './inventory';
import {
	createProduct,
	getProduct,
	listProducts,
	listVariantGroups,
	updateProduct
} from './products';

let db: D1Database;
let database: DatabaseSync;
let product: ReturnType<typeof createFixture>['product'];

beforeEach(() => {
	({ db, database, product } = createFixture());
});

afterEach(() => {
	vi.useRealTimers();
});

const CHECK_FIELDS = 'Revisa los campos marcados en rojo antes de guardar.';

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

function events() {
	return database
		.prepare('select entity_type, action, before, after from events order by id')
		.all();
}

test('creating stores digits only and writes a PRODUCT / CREATED event', async () => {
	const id = await product(chair);
	expect(await getProduct(db, id, MANAGER)).toEqual({
		id,
		name: 'Silla Tiffany',
		category: 'CHAIRS_TABLES',
		variantGroup: null,
		variantName: null,
		description: null,
		websiteUrl: null,
		replacementCost: null,
		rentalPrice: 8000,
		totalQuantity: 120,
		isActive: true
	});
	expect(events()).toMatchObject([{ entity_type: 'PRODUCT', action: 'CREATED', before: null }]);
});

test('editing logs only the changed fields in before/after', async () => {
	const id = await product(chair);
	await updateProduct(db, { ...chair, id, rental_price: '9.000' }, MANAGER);
	const edited = events()[1];
	expect(edited).toMatchObject({ entity_type: 'PRODUCT', action: 'EDITED' });
	expect(JSON.parse(String(edited.before))).toEqual({ rental_price: 8000 });
	expect(JSON.parse(String(edited.after))).toEqual({ rental_price: 9000 });
});

test('an empty description saves no key, and a typed one keeps its line breaks', async () => {
	const id = await product({ ...chair, description: '  ' });
	const attributes = () =>
		database.prepare('select attributes from products where id = ?').get(id)?.attributes;
	expect(attributes()).toBe('{}');
	await updateProduct(db, { ...chair, id, description: 'Blanca.\n\nPlegable.' }, MANAGER);
	expect((await getProduct(db, id, MANAGER))?.description).toBe('Blanca.\n\nPlegable.');
});

test('editing the description logs attributes.description in before/after', async () => {
	const id = await product({ ...chair, description: 'Blanca' });
	await updateProduct(db, { ...chair, id, description: 'Dorada' }, MANAGER);
	const edited = events()[1];
	expect(JSON.parse(String(edited.before))).toEqual({ 'attributes.description': 'Blanca' });
	expect(JSON.parse(String(edited.after))).toEqual({ 'attributes.description': 'Dorada' });
});

test('a page address is trimmed and gets https:// when typed without it', async () => {
	const typed = '  consueloc.com/producto/mantel-dorado/ ';
	const id = await product({ ...chair, website_url: typed });
	const saved = (await getProduct(db, id, MANAGER))?.websiteUrl;
	expect(saved).toBe('https://consueloc.com/producto/mantel-dorado/');
	const elsewhere = await product({
		...chair,
		name: 'Copa',
		website_url: 'https://example.org/copa'
	});
	expect((await getProduct(db, elsewhere, MANAGER))?.websiteUrl).toBe('https://example.org/copa');
});

test('an address that is not https, or not an address, is rejected on its field', async () => {
	for (const address of ['http://x', 'no es una url']) {
		expect(await createProduct(db, { ...chair, website_url: address }, MANAGER)).toEqual({
			ok: false,
			message: CHECK_FIELDS,
			errors: { website_url: 'Escribe una dirección web válida, que empiece con https://' }
		});
	}
});

test('an empty address saves no key, and two products may share one', async () => {
	const id = await product({ ...chair, website_url: ' ' });
	const attributes = database.prepare('select attributes from products where id = ?').get(id);
	expect(attributes?.attributes).toBe('{}');
	const page = 'https://consueloc.com/producto/mantel-cuadrado/';
	const goldenId = await product({ ...golden, website_url: page });
	const red = { ...golden, new_variant_group: '', variant_group: golden.new_variant_group };
	expect(
		await createProduct(db, { ...red, variant_name: 'Rojo', website_url: page }, MANAGER)
	).toMatchObject({ ok: true });
	expect((await getProduct(db, goldenId, MANAGER))?.websiteUrl).toBe(page);
});

test('editing the address logs attributes.website_url in before/after', async () => {
	const id = await product({ ...chair, website_url: 'https://consueloc.com/a/' });
	await updateProduct(db, { ...chair, id, website_url: 'https://consueloc.com/b/' }, MANAGER);
	const edited = events()[1];
	expect(JSON.parse(String(edited.before))).toEqual({
		'attributes.website_url': 'https://consueloc.com/a/'
	});
	expect(JSON.parse(String(edited.after))).toEqual({
		'attributes.website_url': 'https://consueloc.com/b/'
	});
});

test('an edit ignores total_quantity, which stays out of the EDITED event', async () => {
	const id = await product(chair);
	await updateProduct(db, { ...chair, id, total_quantity: '80', rental_price: '9.000' }, MANAGER);
	expect((await getProduct(db, id, MANAGER))?.totalQuantity).toBe(120);
	expect(JSON.parse(String(events()[1].after))).toEqual({ rental_price: 9000 });
});

test('Inactivo deactivates the product, which stays in the list', async () => {
	const id = await product(chair);
	await updateProduct(db, { ...chair, id, active: 'off' }, MANAGER);
	expect((await listProducts(db, {}, MANAGER)).products).toMatchObject([{ id, isActive: false }]);
});

test('the picker lists each group once, with its category', async () => {
	await product(golden);
	const picked = { ...golden, new_variant_group: '', variant_group: 'Mantel cuadrado 50×50' };
	await product({ ...picked, variant_name: 'Rojo' });
	await product(chair);
	expect(await listVariantGroups(db, MANAGER)).toEqual([
		{ name: 'Mantel cuadrado 50×50', category: 'LINENS' }
	]);
});

test('a variant group and a variant name go together', async () => {
	const withoutName = await createProduct(db, { ...golden, variant_name: '' }, MANAGER);
	expect(withoutName).toMatchObject({
		ok: false,
		message: CHECK_FIELDS,
		errors: { variant_name: 'Escribe la variante' }
	});
	const withoutGroup = await createProduct(db, { ...golden, new_variant_group: '' }, MANAGER);
	expect(withoutGroup).toMatchObject({
		ok: false,
		message: CHECK_FIELDS,
		errors: { variant_group: 'Escoge el grupo de la variante' }
	});
});

test('a variant already in its group, ignoring case, fails on the UNIQUE index with a message on Variante', async () => {
	await product(golden);
	const picked = { ...golden, new_variant_group: '', variant_group: 'Mantel cuadrado 50×50' };
	const result = await createProduct(db, { ...picked, variant_name: 'DORADO' }, MANAGER);
	expect(result).toEqual({
		ok: false,
		message: CHECK_FIELDS,
		errors: { variant_name: 'Esa variante ya existe en el grupo' }
	});
	expect((await product({ ...picked, variant_name: 'Rojo' })) > 0).toBe(true);
});

test('a new group matching an existing one, ignoring case, must be picked from the list', async () => {
	await product(golden);
	const result = await createProduct(
		db,
		{ ...golden, new_variant_group: 'MANTEL cuadrado 50×50', variant_name: 'Rojo' },
		MANAGER
	);
	expect(result).toEqual({
		ok: false,
		message: CHECK_FIELDS,
		errors: { new_variant_group: 'Ese grupo ya existe: escógelo de la lista' }
	});
});

test('a picked group that does not exist is rejected', async () => {
	const result = await createProduct(
		db,
		{ ...golden, new_variant_group: '', variant_group: 'Mantel redondo' },
		MANAGER
	);
	expect(result).toEqual({
		ok: false,
		message: CHECK_FIELDS,
		errors: { variant_group: 'Escoge un grupo de la lista' }
	});
});

test('the price per day must be above zero; the total quantity may be zero', async () => {
	const free = await createProduct(db, { ...chair, rental_price: '0' }, MANAGER);
	expect(free).toEqual({
		ok: false,
		message: CHECK_FIELDS,
		errors: { rental_price: 'El precio por día debe ser mayor que cero' }
	});
	expect((await product({ ...chair, total_quantity: '0' })) > 0).toBe(true);
});

test('SALES lists products but cannot open, create or edit one', async () => {
	const id = await product(chair);
	expect((await listProducts(db, {}, SALES)).products).toHaveLength(1);
	const refusals = await Promise.all([
		getProduct(db, id, SALES).catch((caught: unknown) => caught),
		createProduct(db, chair, SALES).catch((caught: unknown) => caught),
		updateProduct(db, { ...chair, id }, SALES).catch((caught: unknown) => caught)
	]);
	for (const refusal of refusals) {
		expect(isHttpError(refusal, 403)).toBe(true);
	}
});

test('WAREHOUSE and DRIVER get a 403 on the list', async () => {
	for (const actor of [WAREHOUSE, DRIVER]) {
		await expect(listProducts(db, {}, actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
});

test('the list narrows by text and category, each variant on its own', async () => {
	await product(chair);
	await product(golden);
	const red = { name: 'Mantel cuadrado 50×50 — Rojo', variant_name: 'Rojo' };
	await product({
		...golden,
		...red,
		new_variant_group: '',
		variant_group: 'Mantel cuadrado 50×50'
	});
	await product({ ...chair, name: 'Copa cristalería', category: 'GLASSWARE' });
	const names = async (input: Record<string, string>) =>
		(await listProducts(db, input, MANAGER)).products.map(({ name }) => name);
	expect(await names({ search: 'ROJO' })).toEqual([red.name]);
	expect(await names({ search: '50×50' })).toEqual([golden.name, red.name]);
	expect(await names({ search: 'cristaleria' })).toEqual(['Copa cristalería']);
	expect(await names({ search: 'silla', category: 'LINENS' })).toEqual([]);
	expect(await names({ category: 'CHAIRS_TABLES' })).toEqual(['Silla Tiffany']);
	// A tampered category is ignored, not an error.
	expect(await names({ category: 'NOPE' })).toHaveLength(4);
});

test('the list dates each product by the last event that changed its total_quantity', async () => {
	// The catalog's products are seeded with no event at all, so each is dated by its creation.
	({ db, database, product } = createFixture({ catalog: true }));
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(1_900_000_000_000);
	const id = await product(chair);
	vi.setSystemTime(2_000_000_000_000);
	const count = { items: [{ product_id: id, counted_qty: 100 }] };
	expect(await submitAndApproveCount(db, count, MANAGER)).toMatchObject({ ok: true });
	vi.setSystemTime(2_100_000_000_000);
	await updateProduct(db, { ...chair, id, rental_price: '9.000' }, MANAGER);
	const seeded = database
		.prepare("select id, created_at from products where name = 'Tablones'")
		.get();
	const dates = (await listProducts(db, {}, MANAGER)).products.map(({ id, quantityUpdatedAt }) => [
		id,
		quantityUpdatedAt
	]);
	expect(dates).toEqual(
		expect.arrayContaining([
			[id, 2_000_000_000],
			[seeded?.id, seeded?.created_at]
		])
	);
});

test('a replacement cost is saved in whole pesos and read back', async () => {
	const id = await product({ ...chair, replacement_cost: '$95.000' });
	expect((await getProduct(db, id, MANAGER))?.replacementCost).toBe(95000);
});

test('clearing the replacement cost removes the key, leaving the product without a cost', async () => {
	const id = await product({ ...chair, replacement_cost: '95.000' });
	await updateProduct(db, { ...chair, id, replacement_cost: ' ' }, MANAGER);
	const attributes = database.prepare('select attributes from products where id = ?').get(id);
	expect(attributes?.attributes).toBe('{}');
	expect((await getProduct(db, id, MANAGER))?.replacementCost).toBeNull();
});

test('a replacement cost that is not whole pesos above zero is refused on its field', async () => {
	for (const typed of ['0', '$0', '-5.000', '95.000,50', '95,5', '12.5', 'mucho']) {
		expect(await createProduct(db, { ...chair, replacement_cost: typed }, MANAGER)).toEqual({
			ok: false,
			message: CHECK_FIELDS,
			errors: { replacement_cost: 'Escribe el costo en pesos enteros, mayor que cero' }
		});
	}
});

test('a change of replacement cost is logged in the product EDITED event', async () => {
	const id = await product({ ...chair, replacement_cost: '95.000' });
	await updateProduct(db, { ...chair, id, replacement_cost: '$110.000' }, MANAGER);
	const edited = events()[1];
	expect(edited).toMatchObject({ entity_type: 'PRODUCT', action: 'EDITED' });
	expect(JSON.parse(String(edited.before))).toEqual({ 'attributes.replacement_cost': 95000 });
	expect(JSON.parse(String(edited.after))).toEqual({ 'attributes.replacement_cost': 110000 });
});
