// Colombian number display: dots between thousands, even for four digits, no decimals.
const grouped = new Intl.NumberFormat('es-CO', { useGrouping: 'always', maximumFractionDigits: 0 });

/** Whole pesos as `$1.423.500`. */
export function formatPesos(pesos: number): string {
	return `$${grouped.format(pesos)}`;
}

/** A movement's pesos with its direction: `+$680.000` in, `−$222.000` out (a minus sign, not a hyphen). */
export function formatSignedPesos(pesos: number): string {
	return `${pesos < 0 ? '−' : '+'}${formatPesos(Math.abs(pesos))}`;
}

/** A whole number with its thousands grouped, the way people type it: `1.750.905`. */
export function formatInteger(value: number): string {
	return grouped.format(value);
}

/** A stored ID number (digits only) as people write it: `71.384.902`. */
export function formatIdNumber(digits: string): string {
	return formatInteger(Number(digits));
}

/** Worked minutes as hours with one decimal, a dot as the separator: `8.1 h`. */
export function formatHours(minutes: number): string {
	return `${(minutes / 60).toFixed(1)} h`;
}

/** A receipt's consecutive with at least four digits: `0089`; past them it just grows, `12345`. */
export function formatReceiptNumber(receiptNumber: number): string {
	return String(receiptNumber).padStart(4, '0');
}
