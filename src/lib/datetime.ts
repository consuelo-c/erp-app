// Workers run in UTC and browsers in the device's zone; every date the app uses is Bogotá's.
const COMPANY_TIMEZONE = 'America/Bogota';

// en-CA formats dates as YYYY-MM-DD.
const civilDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TIMEZONE });

// Only numeric parts: the words Intl puts around a locale's date ("a las", ",") change between ICU
// versions, so the server and the browser could render the same instant differently.
const instantPartsFormat = new Intl.DateTimeFormat('en-US', {
	timeZone: COMPANY_TIMEZONE,
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit',
	hourCycle: 'h23'
});

const MONTH_NAMES = [
	'enero',
	'febrero',
	'marzo',
	'abril',
	'mayo',
	'junio',
	'julio',
	'agosto',
	'septiembre',
	'octubre',
	'noviembre',
	'diciembre'
];

/** Current date (YYYY-MM-DD) in Bogotá. */
export function getTodaysDate(): string {
	return civilDateFormat.format(new Date());
}

/** A UTC instant (epoch seconds) formatted in Bogotá time, for display. */
export function formatInstant(epochSeconds: number): string {
	const parts = instantPartsFormat.formatToParts(new Date(epochSeconds * 1000));
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((candidate) => type === candidate.type)?.value);
	const hour = part('hour');
	const minute = String(part('minute')).padStart(2, '0');
	const period = hour < 12 ? 'a.m.' : 'p.m.';
	const date = `${part('day')} de ${MONTH_NAMES[part('month') - 1]} de ${part('year')}`;
	return `${date}, ${hour % 12 || 12}:${minute} ${period}`;
}
