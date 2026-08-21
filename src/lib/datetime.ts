/** Zona de operación. No escribir esta cadena literal en ningún otro archivo. */
export const COMPANY_TIMEZONE = 'America/Bogota';

/**
 * Fecha actual (`YYYY-MM-DD`) en la zona horaria indicada.
 *
 * Se arma con `formatToParts` y no con un locale que imprima en orden ISO: así
 * el resultado no depende del ICU del entorno donde corra el Worker.
 */
export function getTodaysDate(timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(new Date());

	const value = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)!.value;

	return `${value('year')}-${value('month')}-${value('day')}`;
}

/**
 * Instante actual como epoch en segundos, UTC: el formato de `created_at`,
 * `updated_at` y `expires_at`. Las fechas y horas de negocio son civiles, van
 * como TEXT y no pasan por aquí.
 */
export function nowEpoch(): number {
	return Math.floor(Date.now() / 1000);
}
