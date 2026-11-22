import { render } from 'svelte/server';
import { expect, test, vi } from 'vitest';
import type { ListedProduct } from '$lib/server/services/products';
import Page from './+page.svelte';

// The list reads «guardado» from the URL the form's redirect leaves.
const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/productos') } }));
vi.mock('$app/state', () => state);

const product: ListedProduct = {
	id: 7,
	name: 'Silla Tiffany dorada',
	category: 'CHAIRS_TABLES',
	variantGroup: null,
	variantName: null,
	description: null,
	websiteUrl: 'https://consueloc.com/producto/silla-tiffany-dorada/',
	replacementCost: null,
	rentalPrice: 8000,
	totalQuantity: 120,
	isActive: false,
	quantityUpdatedAt: 1792000000
};

function listOf(products: ListedProduct[], canEdit: boolean): string {
	const data = { products, filters: { search: '' }, canEdit };
	// Svelte's hydration markers out, so the markup reads as written.
	return render(Page, { props: { data } as never }).body.replaceAll(/<!--[^>]*-->/g, '');
}

const PAGE_LINK =
	/<a target="_blank" rel="noopener" href="https:\/\/consueloc\.com\/producto\/silla-tiffany-dorada\/" class="icon-btn[^"]*" aria-label="Abrir página" title="Abrir página">/;

test('a product with a page gets the external-link icon after its name, for every role', () => {
	for (const canEdit of [true, false]) {
		const body = listOf([product], canEdit);
		expect(body).toMatch(PAGE_LINK);
		expect(body).toContain('/icons.svg#external-link');
		// After the name, before the ℹ and the «Inactivo» badge.
		const [name, link, info, badge] = [
			body.indexOf('Silla Tiffany dorada<'),
			body.search(PAGE_LINK),
			body.indexOf('/icons.svg#info'),
			body.indexOf('Inactivo</')
		];
		expect(name < link && link < info && info < badge).toBe(true);
	}
});

test('for ADMIN and MANAGER the icon sits above the row link, so it opens only the page', () => {
	const body = listOf([product], true);
	expect(body).toMatch(/class="table__link[^"]*" href="\/productos\/7"/);
	expect(body).toMatch(/<span class="page-link[^"]*">\s*<a target="_blank"/);
});

test('a product without a page gets no icon', () => {
	expect(listOf([{ ...product, websiteUrl: null }], true)).not.toContain('external-link');
});
