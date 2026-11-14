import { formatCivilDate, getInstantDate } from '$lib/datetime';
import { formatInteger, formatPesos } from '$lib/format';
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

/** «Modificado 12 oct 2026», the Bogotá date of the last change. */
function describeModified(updatedAt: number): string {
	return `Modificado ${formatModified(updatedAt)}`;
}

/** A row's figure on the right, its price per day, and its gray line under the name. */
export type RowSummary = { price: string; meta: string };

/** «$2.500» and «800 en inventario · Modificado 12 oct 2026». */
export function summarizeProduct(product: Product): RowSummary {
	const stock = `${formatInteger(product.totalQuantity)} en inventario`;
	return {
		price: formatPesos(product.rentalPrice),
		meta: `${stock} · ${describeModified(product.updatedAt)}`
	};
}

/**
 * «$8.000 – $9.500», or a single price when they all cost the same, and «4 variantes · Modificado
 * 13 oct 2026», the latest change among the variants.
 */
export function summarizeGroup(variants: Product[]): RowSummary {
	const prices = variants.map((variant) => variant.rentalPrice);
	const [lowest, highest] = [Math.min(...prices), Math.max(...prices)];
	const latest = Math.max(...variants.map((variant) => variant.updatedAt));
	return {
		price:
			lowest === highest ? formatPesos(lowest) : `${formatPesos(lowest)} – ${formatPesos(highest)}`,
		meta: `${countVariants(variants)} · ${describeModified(latest)}`
	};
}

/** A variant's «Modificado» column: «12 oct 2026». */
export function formatModified(updatedAt: number): string {
	return formatCivilDate(getInstantDate(updatedAt));
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
