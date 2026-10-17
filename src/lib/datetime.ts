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

const WEEKDAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

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
	const date = `${part('day')} de ${MONTH_NAMES[part('month') - 1]} de ${part('year')}`;
	return `${date}, ${formatTime(part('hour'), part('minute'))}`;
}

function formatTime(hour: number, minute: number): string {
	const period = hour < 12 ? 'a.m.' : 'p.m.';
	return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`;
}

/** A clock time (`HH:MM`) as `7:02 a.m.`. */
export function formatClockTime(clockTime: string): string {
	const [hour, minute] = clockTime.split(':').map(Number);
	return formatTime(hour, minute);
}

/** A civil date (YYYY-MM-DD) as `3 feb 2025`. Split, never parsed into a Date: it has no zone. */
export function formatCivilDate(date: string): string {
	const [year, month, day] = date.split('-');
	return `${Number(day)} ${MONTH_NAMES[Number(month) - 1].slice(0, 3)} ${year}`;
}

// Civil-date arithmetic through UTC midnight: no zone, so no daylight-saving or offset surprises.
function toUtcDate(date: string): Date {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day));
}

/** The civil date `days` after `date` (before, when negative). */
export function addDays(date: string, days: number): string {
	const moved = toUtcDate(date);
	moved.setUTCDate(moved.getUTCDate() + days);
	const month = String(moved.getUTCMonth() + 1).padStart(2, '0');
	const day = String(moved.getUTCDate()).padStart(2, '0');
	return `${moved.getUTCFullYear()}-${month}-${day}`;
}

/** The Monday of `date`'s week: weeks run Monday to Sunday. */
export function getWeekStart(date: string): string {
	const daysSinceMonday = (toUtcDate(date).getUTCDay() + 6) % 7;
	return addDays(date, -daysSinceMonday);
}

function formatDayAndMonth(date: string): string {
	const [, month, day] = date.split('-');
	return `${Number(day)} ${MONTH_NAMES[Number(month) - 1].slice(0, 3)}`;
}

/** A civil date as `Lun 27 jul`. */
export function formatShortDay(date: string): string {
	return `${WEEKDAY_NAMES[toUtcDate(date).getUTCDay()]} ${formatDayAndMonth(date)}`;
}

/** A civil date as `Vie 31 jul 2026`. */
export function formatLongDay(date: string): string {
	return `${WEEKDAY_NAMES[toUtcDate(date).getUTCDay()]} ${formatCivilDate(date)}`;
}

/** A Monday-to-Sunday week as `27 jul – 2 ago`. */
export function formatWeekRange(weekStart: string): string {
	return `${formatDayAndMonth(weekStart)} – ${formatDayAndMonth(addDays(weekStart, 6))}`;
}
