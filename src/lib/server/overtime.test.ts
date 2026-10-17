import { expect, test } from 'vitest';
import { deriveOvertime, type DayPunches, type OvertimeParameters } from './overtime';

// The defaults from scripts/settings-defaults.sql.
const parameters: OvertimeParameters = {
	PAYROLL_ORDINARY_HOURS_PER_DAY: 7,
	PAYROLL_NIGHT_START: '19:00',
	PAYROLL_NIGHT_END: '06:00'
};

const SATURDAY = '2026-08-01';
const SUNDAY = '2026-08-02';
const TUESDAY = '2026-07-28';
const HOLIDAY = '2026-08-07';

const zero = {
	nightSurcharge: 0,
	daytimeOvertime: 0,
	nightOvertime: 0,
	daytimeHolidayOvertime: 0,
	nightHolidayOvertime: 0
};

function day(workDate: string, punches: Partial<DayPunches>): DayPunches {
	return {
		workDate,
		morningIn: null,
		morningOut: null,
		afternoonIn: null,
		afternoonOut: null,
		...punches
	};
}

const saturdayAfternoon = day(SATURDAY, { afternoonIn: '14:00', afternoonOut: '22:00' });

test('Saturday 14:00–22:00: 2h night surcharge and 1h night overtime', () => {
	expect(deriveOvertime(saturdayAfternoon, false, parameters)).toEqual({
		...zero,
		nightSurcharge: 120,
		nightOvertime: 60
	});
});

test('Tuesday 08:00–12:00 and 14:00–17:00: all ordinary daytime', () => {
	const punches = {
		morningIn: '08:00',
		morningOut: '12:00',
		afternoonIn: '14:00',
		afternoonOut: '17:00'
	};
	expect(deriveOvertime(day(TUESDAY, punches), false, parameters)).toEqual(zero);
});

test('Tuesday 08:00–12:00 and 14:00–19:00: 2h daytime overtime', () => {
	const punches = {
		morningIn: '08:00',
		morningOut: '12:00',
		afternoonIn: '14:00',
		afternoonOut: '19:00'
	};
	expect(deriveOvertime(day(TUESDAY, punches), false, parameters)).toEqual({
		...zero,
		daytimeOvertime: 120
	});
});

test('Sunday 09:00–15:00: 6h daytime holiday overtime, no 7-hour cutoff', () => {
	const sunday = day(SUNDAY, { morningIn: '09:00', morningOut: '15:00' });
	expect(deriveOvertime(sunday, false, parameters)).toEqual({
		...zero,
		daytimeHolidayOvertime: 360
	});
});

test('holiday 18:00–23:00: 1h daytime and 4h night holiday overtime', () => {
	const holiday = day(HOLIDAY, { afternoonIn: '18:00', afternoonOut: '23:00' });
	expect(deriveOvertime(holiday, true, parameters)).toEqual({
		...zero,
		daytimeHolidayOvertime: 60,
		nightHolidayOvertime: 240
	});
});

test('a day with no punches is zero', () => {
	expect(deriveOvertime(day(TUESDAY, {}), false, parameters)).toEqual(zero);
});

test('a clock-in with no clock-out is zero, never negative', () => {
	const unfinished = day(SATURDAY, { afternoonIn: '14:00' });
	expect(deriveOvertime(unfinished, false, parameters)).toEqual(zero);
});

test('the night cutoff comes from the parameters: at 20:00 the result changes', () => {
	const laterNight = { ...parameters, PAYROLL_NIGHT_START: '20:00' };
	expect(deriveOvertime(saturdayAfternoon, false, laterNight)).toEqual({
		...zero,
		nightSurcharge: 60,
		nightOvertime: 60
	});
});

test('the ordinary hours come from the parameters', () => {
	const shorterDay = { ...parameters, PAYROLL_ORDINARY_HOURS_PER_DAY: 6 };
	expect(deriveOvertime(saturdayAfternoon, false, shorterDay)).toEqual({
		...zero,
		nightSurcharge: 60,
		nightOvertime: 120
	});
});
