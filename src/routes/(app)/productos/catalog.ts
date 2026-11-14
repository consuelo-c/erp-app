import { CATEGORY_LABELS } from '$lib/labels';
import type { Category, Product } from '$lib/server/services/products';

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as Category[];

/** A product's name on the list: a variant as «Mantel redondo · Rojo» (group · variant). */
export function catalogName(product: Product): string {
	const { name, variantGroup, variantName } = product;
	return null === variantGroup ? name : `${variantGroup} · ${variantName}`;
}

/** One row per product, variants included: by category in `CATEGORY_LABELS`' order, then by name. */
export function sortCatalog<P extends Product>(products: P[]): P[] {
	return [...products].sort(
		(first, second) =>
			CATEGORY_ORDER.indexOf(first.category) - CATEGORY_ORDER.indexOf(second.category) ||
			catalogName(first).localeCompare(catalogName(second), 'es')
	);
}
