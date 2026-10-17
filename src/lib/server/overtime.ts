// Overtime derivation: what a day's punches pay beyond ordinary daytime hours. Pure, no database:
// the caller passes the punches, whether the date is a holiday, and the settings values.

const MINUTES_PER_HOUR = 60;
const SUNDAY = 0;

/** A day's punches, `HH:MM` or null, as stored in `timesheets`. */
export type DayPunches = {
	workDate: string;
	morningIn: string | null;
	morningOut: string | null;
	afternoonIn: string | null;
	afternoonOut: string | null;
};

/** The settings the derivation reads, keyed by setting, already parsed by `SETTINGS`. */
export type OvertimeParameters = {
	PAYROLL_ORDINARY_HOURS_PER_DAY: number;
	PAYROLL_NIGHT_START: string;
	PAYROLL_NIGHT_END: string;
};

/** The five receipt rows, in whole minutes so the payroll multiplies exact quantities. */
export type OvertimeMinutes = {
	nightSurcharge: number;
	daytimeOvertime: number;
	nightOvertime: number;
	daytimeHolidayOvertime: number;
	nightHolidayOvertime: number;
};

type MinuteKind = { isNight: boolean; isOvertime: boolean; isHolidayRate: boolean };

function toMinutes(clockTime: string): number {
	const [hours, minutes] = clockTime.split(':').map(Number);
	return hours * MINUTES_PER_HOUR + minutes;
}

/** Each minute of a block as minutes since midnight; none unless both punches exist and run forward. */
function listBlockMinutes(clockIn: string | null, clockOut: string | null): number[] {
	if (null === clockIn || null === clockOut) {
		return [];
	}
	const start = toMinutes(clockIn);
	const length = Math.max(0, toMinutes(clockOut) - start);
	return Array.from({ length }, (_, offset) => start + offset);
}

// Split, never parsed in a zone: a civil date's weekday is the same everywhere in UTC.
function isSunday(workDate: string): boolean {
	const [year, month, day] = workDate.split('-').map(Number);
	return SUNDAY === new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// The night runs across midnight (19:00 → 06:00), so the window wraps when it starts after it ends.
function isNightMinute(minute: number, nightStart: number, nightEnd: number): boolean {
	if (nightStart > nightEnd) {
		return minute >= nightStart || minute < nightEnd;
	}
	return minute >= nightStart && minute < nightEnd;
}

/** The row a minute pays in, or null for an ordinary daytime minute, which pays in days worked. */
function classifyMinute(kind: MinuteKind): keyof OvertimeMinutes | null {
	if (kind.isHolidayRate) {
		return kind.isNight ? 'nightHolidayOvertime' : 'daytimeHolidayOvertime';
	}
	if (kind.isOvertime) {
		return kind.isNight ? 'nightOvertime' : 'daytimeOvertime';
	}
	return kind.isNight ? 'nightSurcharge' : null;
}

/**
 * Overtime is counted from the end of the day: the minutes past the ordinary hours are the last
 * ones. A Sunday or holiday has no ordinary cutoff: every minute goes to the holiday rows.
 */
export function deriveOvertime(
	day: DayPunches,
	isHoliday: boolean,
	parameters: OvertimeParameters
): OvertimeMinutes {
	const minutes = [
		...listBlockMinutes(day.morningIn, day.morningOut),
		...listBlockMinutes(day.afternoonIn, day.afternoonOut)
	];
	const nightStart = toMinutes(parameters.PAYROLL_NIGHT_START);
	const nightEnd = toMinutes(parameters.PAYROLL_NIGHT_END);
	const isHolidayRate = isHoliday || isSunday(day.workDate);
	const ordinaryMinutes = parameters.PAYROLL_ORDINARY_HOURS_PER_DAY * MINUTES_PER_HOUR;
	const result: OvertimeMinutes = {
		nightSurcharge: 0,
		daytimeOvertime: 0,
		nightOvertime: 0,
		daytimeHolidayOvertime: 0,
		nightHolidayOvertime: 0
	};
	minutes.forEach((minute, index) => {
		const isNight = isNightMinute(minute, nightStart, nightEnd);
		const row = classifyMinute({ isNight, isOvertime: index >= ordinaryMinutes, isHolidayRate });
		if (null !== row) {
			result[row] += 1;
		}
	});
	return result;
}
