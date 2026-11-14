import { formatPesos } from '$lib/format';
import { CATEGORY_LABELS } from '$lib/labels';
import type { Category, Product } from '$lib/server/services/products';

/** A product on its own, or a variant group standing for all its variants. */
export type CatalogRow =
	{ kind: 'product'; product: Product } | { kind: 'group'; name: string; variants: Product[] };

export type CatalogSection = { category: Category; rows: CatalogRow[] };

/** The catalog by category, in `CATEGORY_LABELS`' order, each group folded into one row. */
export function groupCatalog(products: Product[]): CatalogSection[] {
	return (Object.keys(CATEGORY_LABELS) as Category[])
		.map((category) => ({
			category,
			rows: foldGroups(products.filter((product) => category === product.category))
		}))
		.filter(({ rows }) => rows.length > 0);
}

// A group takes its first variant's place, so it keeps the list's order by name.
function foldGroups(products: Product[]): CatalogRow[] {
	const groups = new Map<string, Product[]>();
	const rows: CatalogRow[] = [];
	for (const product of products) {
		const group = product.variantGroup;
		if (null === group) {
			rows.push({ kind: 'product', product });
		} else if (groups.has(group)) {
			groups.get(group)!.push(product);
		} else {
			groups.set(group, [product]);
			rows.push({ kind: 'group', name: group, variants: groups.get(group)! });
		}
	}
	return rows;
}

/** One group's variants, by variant name. */
export function findVariants(products: Product[], group: string): Product[] {
	return products
		.filter((product) => group === product.variantGroup)
		.sort((first, second) => first.variantName!.localeCompare(second.variantName!, 'es'));
}

function countVariants(variants: Product[]): string {
	return `${variants.length} ${1 === variants.length ? 'variante' : 'variantes'}`;
}

/** «4 variantes · $8.000 – $9.500», or a single price when they all cost the same. */
export function summarizeGroup(variants: Product[]): string {
	const prices = variants.map((variant) => variant.rentalPrice);
	const [lowest, highest] = [Math.min(...prices), Math.max(...prices)];
	const range =
		lowest === highest ? formatPesos(lowest) : `${formatPesos(lowest)} – ${formatPesos(highest)}`;
	return `${countVariants(variants)} · ${range}`;
}

/** «Manteles y ruches · 20 variantes · 1 inactiva». */
export function describeGroup(variants: Product[]): string {
	const parts = [CATEGORY_LABELS[variants[0].category], countVariants(variants)];
	const inactive = variants.filter((variant) => !variant.isActive).length;
	if (inactive > 0) {
		parts.push(`${inactive} ${1 === inactive ? 'inactiva' : 'inactivas'}`);
	}
	return parts.join(' · ');
}
