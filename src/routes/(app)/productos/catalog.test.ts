import { expect, test } from 'vitest';
import type { Product } from '$lib/server/services/products';
import { describeGroup, findVariants, groupCatalog, summarizeGroup } from './catalog';

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

const variant = (name: string, rentalPrice: number, isActive = true) =>
	product(`Mantel cuadrado 50×50 — ${name}`, {
		variantGroup: 'Mantel cuadrado 50×50',
		variantName: name,
		rentalPrice,
		isActive
	});

test('the catalog follows the categories, folds a group into one row and skips empty categories', () => {
	const chair = product('Silla Tiffany', { category: 'CHAIRS_TABLES' });
	const linen = product('Mantel blanco 3×3');
	const [red, golden] = [variant('Rojo', 8000), variant('Dorado', 9500, false)];
	const sections = groupCatalog([linen, red, golden, chair]);
	expect(sections).toEqual([
		{ category: 'CHAIRS_TABLES', rows: [{ kind: 'product', product: chair }] },
		{
			category: 'LINENS',
			rows: [
				{ kind: 'product', product: linen },
				{ kind: 'group', name: 'Mantel cuadrado 50×50', variants: [red, golden] }
			]
		}
	]);
	expect(summarizeGroup([red, golden])).toBe('2 variantes · $8.000 – $9.500');
	expect(summarizeGroup([red])).toBe('1 variante · $8.000');
	expect(describeGroup([red, golden])).toBe('Manteles y ruches · 2 variantes · 1 inactiva');
	expect(findVariants([linen, red, golden], 'Mantel cuadrado 50×50')).toEqual([golden, red]);
});
