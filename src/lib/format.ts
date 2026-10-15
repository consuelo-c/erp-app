// Colombian number display: dots between thousands, even for four digits, no decimals.
const grouped = new Intl.NumberFormat('es-CO', { useGrouping: 'always', maximumFractionDigits: 0 });

/** Whole pesos as `$1.423.500`. */
export function formatPesos(pesos: number): string {
	return `$${grouped.format(pesos)}`;
}

/** A stored ID number (digits only) as people write it: `71.384.902`. */
export function formatIdNumber(digits: string): string {
	return grouped.format(Number(digits));
}
