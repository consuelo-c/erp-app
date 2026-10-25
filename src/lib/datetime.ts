import { z } from 'zod';

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

/** The Bogotá time of a UTC instant (epoch seconds): `3:30 p.m.`. */
export function formatInstantTime(epochSeconds: number): string {
	const parts = instantPartsFormat.formatToParts(new Date(epochSeconds * 1000));
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((candidate) => type === candidate.type)?.value);
	return formatTime(part('hour'), part('minute'));
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

// A clock time is typed the way people say it: 1 to 12, the minutes, and a.m. or p.m.
const HOUR_MESSAGE = 'Escribe la hora, de 1 a 12';
const MINUTE_MESSAGE = 'Escribe los minutos, de 0 a 59';

/** The three fields of a typed clock time, for a Zod object; `toClockTime` turns them into `HH:MM`. */
export const dialTimeShape = {
	hour: z.coerce
		.number({ error: HOUR_MESSAGE })
		.int(HOUR_MESSAGE)
		.min(1, HOUR_MESSAGE)
		.max(12, HOUR_MESSAGE),
	minute: z.coerce
		.number({ error: MINUTE_MESSAGE })
		.int(MINUTE_MESSAGE)
		.min(0, MINUTE_MESSAGE)
		.max(59, MINUTE_MESSAGE),
	period: z.enum(['am', 'pm'], 'Escoge a.m. o p.m.')
};

type DialTime = { hour: number; minute: number; period: 'am' | 'pm' };

/** A typed clock time as `HH:MM`. 12 a.m. is midnight (00) and 12 p.m. is noon (12). */
export function toClockTime({ hour, minute, period }: DialTime): string {
	const hour24 = (hour % 12) + ('pm' === period ? 12 : 0);
	return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * An optional time as typed in a `ClockField`: `HH:MM`, null when the hour is blank (the minutes
 * then default to 00), or the text as typed when it isn't a time, for the server to refuse.
 */
export function typedClockTime(typed: {
	hour: string;
	minute: string;
	period: 'am' | 'pm';
}): string | null {
	const { hour, minute, period } = typed;
	if ('' === hour.trim()) {
		return null;
	}
	const parsed = z.object(dialTimeShape).safeParse({ hour, minute: minute.trim() || '0', period });
	return parsed.success ? toClockTime(parsed.data) : `${hour}:${minute}`;
}

/** `HH:MM` as the fields show it: 1 to 12, the minutes, and a.m. or p.m. */
export function toDialTime(clockTime: string) {
	const [hour24, minutes] = clockTime.split(':').map(Number);
	return {
		hour: String(hour24 % 12 || 12),
		minute: String(minutes).padStart(2, '0'),
		period: hour24 < 12 ? ('am' as const) : ('pm' as const)
	};
}

/** A clock time as `7:02`, for columns that already say morning or afternoon. */
export function formatShortClockTime(clockTime: string): string {
	return formatClockTime(clockTime).split(' ')[0];
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

/** The first and last civil dates of `date`'s month. */
export function getMonthRange(date: string): { start: string; end: string } {
	const start = `${date.slice(0, 7)}-01`;
	// 31 days past the 1st always lands in the next month, whatever this one's length.
	const nextMonth = `${addDays(start, 31).slice(0, 7)}-01`;
	return { start, end: addDays(nextMonth, -1) };
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

/** A civil date as `Lun 27`, where the week already says the month. */
export function formatWeekday(date: string): string {
	return `${WEEKDAY_NAMES[toUtcDate(date).getUTCDay()]} ${Number(date.split('-')[2])}`;
}

/** A civil date as `Vie 31 jul 2026`. */
export function formatLongDay(date: string): string {
	return `${WEEKDAY_NAMES[toUtcDate(date).getUTCDay()]} ${formatCivilDate(date)}`;
}

/** Two civil dates as `27 jul – 1 ago`. */
export function formatDayRange(start: string, end: string): string {
	return `${formatDayAndMonth(start)} – ${formatDayAndMonth(end)}`;
}

/** A filtered period: `1 – 31 oct 2026` within a month, `28 sep – 3 oct 2026` across two. */
export function formatPeriod(start: string, end: string): string {
	const endYear = end.slice(0, 4);
	if (start.slice(0, 7) === end.slice(0, 7)) {
		return `${Number(start.slice(8))} – ${formatDayAndMonth(end)} ${endYear}`;
	}
	const startYear = start.slice(0, 4) === endYear ? '' : ` ${start.slice(0, 4)}`;
	return `${formatDayAndMonth(start)}${startYear} – ${formatDayAndMonth(end)} ${endYear}`;
}

/** A Monday-to-Sunday week as `27 jul – 2 ago`. */
export function formatWeekRange(weekStart: string): string {
	return formatDayRange(weekStart, addDays(weekStart, 6));
}
