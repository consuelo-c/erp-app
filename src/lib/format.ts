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

/** A stored ID number as people write it: `71.384.902`; a passport, with letters, as stored. */
export function formatIdNumber(documentId: string): string {
	return /^\d+$/.test(documentId) ? formatInteger(Number(documentId)) : documentId;
}

/** Worked minutes as hours with one decimal, a dot as the separator: `8.1 h`. */
export function formatHours(minutes: number): string {
	return `${(minutes / 60).toFixed(1)} h`;
}

/** A receipt's consecutive with at least four digits: `0089`; past them it just grows, `12345`. */
export function formatReceiptNumber(receiptNumber: number): string {
	return String(receiptNumber).padStart(4, '0');
}

// Up to 29 a number is one word. Each already cut short the way it reads before a noun: «un»,
// «veintiún», since every group here is followed by «mil», «millones» or «pesos».
const UP_TO_TWENTY_NINE = [
	'',
	'un',
	'dos',
	'tres',
	'cuatro',
	'cinco',
	'seis',
	'siete',
	'ocho',
	'nueve',
	'diez',
	'once',
	'doce',
	'trece',
	'catorce',
	'quince',
	'dieciséis',
	'diecisiete',
	'dieciocho',
	'diecinueve',
	'veinte',
	'veintiún',
	'veintidós',
	'veintitrés',
	'veinticuatro',
	'veinticinco',
	'veintiséis',
	'veintisiete',
	'veintiocho',
	'veintinueve'
];
const TENS = [
	'',
	'',
	'',
	'treinta',
	'cuarenta',
	'cincuenta',
	'sesenta',
	'setenta',
	'ochenta',
	'noventa'
];
const HUNDREDS = [
	'',
	'ciento',
	'doscientos',
	'trescientos',
	'cuatrocientos',
	'quinientos',
	'seiscientos',
	'setecientos',
	'ochocientos',
	'novecientos'
];

function belowHundredInWords(value: number): string {
	if (value < 30) {
		return UP_TO_TWENTY_NINE[value];
	}
	const tens = TENS[Math.floor(value / 10)];
	const units = value % 10;
	return 0 === units ? tens : `${tens} y ${UP_TO_TWENTY_NINE[units]}`;
}

// 1 to 999. A hundred alone is «cien»; with more after it, «ciento».
function belowThousandInWords(value: number): string {
	if (100 === value) {
		return 'cien';
	}
	return [HUNDREDS[Math.floor(value / 100)], belowHundredInWords(value % 100)]
		.filter(Boolean)
		.join(' ');
}

function thousandsInWords(count: number): string {
	if (0 === count) {
		return '';
	}
	return 1 === count ? 'mil' : `${belowThousandInWords(count)} mil`;
}

function millionsInWords(count: number): string {
	if (0 === count) {
		return '';
	}
	return 1 === count ? 'un millón' : `${belowThousandInWords(count)} millones`;
}

/**
 * Whole pesos in words, as a receipt writes them: `Cuarenta y ocho mil quinientos pesos m/cte`.
 * Up to 999.999.999; the sign is ignored.
 */
export function formatPesosInWords(pesos: number): string {
	const value = Math.abs(pesos);
	const millions = Math.floor(value / 1_000_000);
	const number = [
		millionsInWords(millions),
		thousandsInWords(Math.floor(value / 1000) % 1000),
		belowThousandInWords(value % 1000)
	]
		.filter(Boolean)
		.join(' ');
	// A round million is «un millón de pesos», «dos millones de pesos».
	const isRoundMillions = 0 < millions && 0 === value % 1_000_000;
	const words = `${number}${isRoundMillions ? ' de' : ''} pesos m/cte`;
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
