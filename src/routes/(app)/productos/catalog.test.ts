import { expect, test } from 'vitest';
import type { Product } from '$lib/server/services/products';
import { catalogName, sortCatalog } from './catalog';

const product = (name: string, extra: Partial<Product> = {}): Product => ({
	id: 0,
	name,
	category: 'LINENS',
	variantGroup: null,
	variantName: null,
	description: null,
	rentalPrice: 8000,
	totalQuantity: 10,
	isActive: true,
	...extra
});

const variant = (name: string) =>
	product(`Mantel cuadrado 50×50 — ${name}`, {
		variantGroup: 'Mantel cuadrado 50×50',
		variantName: name
	});

test('the catalog goes by category, then by name, a variant named «group · variant»', () => {
	const chair = product('Silla Tiffany', { category: 'CHAIRS_TABLES' });
	const linen = product('Mantel blanco 3×3');
	const [red, golden] = [variant('Rojo'), variant('Dorado')];
	expect(sortCatalog([red, linen, golden, chair])).toEqual([chair, linen, golden, red]);
	expect(catalogName(red)).toBe('Mantel cuadrado 50×50 · Rojo');
	expect(catalogName(chair)).toBe('Silla Tiffany');
});
