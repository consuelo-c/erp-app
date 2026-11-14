import { expect, test } from 'vitest';
import type { Product } from '$lib/server/services/products';
import {
	describeGroup,
	findVariants,
	groupCatalog,
	summarizeGroup,
	summarizeProduct
} from './catalog';

const at = (iso: string) => Date.parse(iso) / 1000;

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
	updatedAt: at('2026-10-12T17:00:00Z'),
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
	expect(summarizeGroup([red])).toEqual({
		price: '$8.000',
		meta: '1 variante · Modificado 12 oct 2026'
	});
	expect(describeGroup([red, golden])).toBe('Manteles y ruches · 2 variantes · 1 inactiva');
	expect(findVariants([linen, red, golden], 'Mantel cuadrado 50×50')).toEqual([golden, red]);
});

test('a row shows its price per day, and a group its range and its latest change in Bogotá', () => {
	const chair = product('Silla Rimax', { rentalPrice: 2500, totalQuantity: 800 });
	expect(summarizeProduct(chair)).toEqual({
		price: '$2.500',
		meta: '800 en inventario · Modificado 12 oct 2026'
	});
	// 03:00 UTC on the 14th is still the 13th in Bogotá.
	const late = { ...variant('Dorado', 9500), updatedAt: at('2026-10-14T03:00:00Z') };
	expect(summarizeGroup([variant('Rojo', 8000), late])).toEqual({
		price: '$8.000 – $9.500',
		meta: '2 variantes · Modificado 13 oct 2026'
	});
});
