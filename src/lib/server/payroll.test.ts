import { expect, test } from 'vitest';
import {
	calculateSettlement,
	deriveRates,
	getExtraHoursRange,
	type EarningConcept,
	type HourConcept,
	type PayrollParameters,
	type QuantityConcept,
	type SettlementInput
} from './payroll';

// The default settings (scripts/settings-defaults.sql).
const DEFAULTS: PayrollParameters = {
	PAYROLL_DAYS_PER_MONTH: 30,
	PAYROLL_HOURS_PER_MONTH: 210,
	PAYROLL_TRANSPORT_ALLOWANCE: 249095,
	PAYROLL_HOLIDAY_OVERTIME_DAY_FACTOR: 215,
	PAYROLL_HOLIDAY_OVERTIME_NIGHT_FACTOR: 265,
	PAYROLL_OVERTIME_DAY_FACTOR: 125,
	PAYROLL_OVERTIME_NIGHT_FACTOR: 175,
	PAYROLL_NIGHT_SURCHARGE_FACTOR: 35,
	PAYROLL_PENSION_RATE: 4,
	PAYROLL_HEALTH_RATE: 4
};

const SALARY = 1750905;

const NO_QUANTITIES: Record<QuantityConcept, number> = {
	DAYS_WORKED: 0,
	SUNDAY_REST: 0,
	HOLIDAY_OVERTIME_DAY: 0,
	HOLIDAY_OVERTIME_NIGHT: 0,
	OVERTIME_DAY: 0,
	OVERTIME_NIGHT: 0,
	NIGHT_SURCHARGE: 0,
	TRANSPORT_ALLOWANCE: 0
};

// A usual week: six days worked, the Sunday rest and six days of transport allowance.
function settle(
	quantities: Partial<Record<QuantityConcept, number>> = {},
	typed: Partial<Omit<SettlementInput, 'monthlySalary' | 'quantities'>> = {},
	parameters = DEFAULTS
) {
	const input = {
		monthlySalary: SALARY,
		quantities: {
			...NO_QUANTITIES,
			DAYS_WORKED: 6,
			SUNDAY_REST: 1,
			TRANSPORT_ALLOWANCE: 6,
			...quantities
		},
		nonSalaryBonus: 0,
		loans: 0,
		other: 0,
		...typed
	};
	return calculateSettlement(input, parameters);
}

function amountOf(concept: EarningConcept, settlement = settle()) {
	return settlement.earnings.find((line) => concept === line.concept)?.amount;
}

test('the day and hour values derive from the salary and agree with each other', () => {
	const { dayValue, hourValue } = deriveRates(SALARY, DEFAULTS);
	expect(dayValue).toBe(58363.5);
	expect(hourValue).toBeCloseTo(8337.642857, 6);
	expect(dayValue / 7).toBeCloseTo(hourValue, 9);
});

test('each earning line rounds to the peso as it is calculated', () => {
	const settlement = settle({ OVERTIME_DAY: 1, NIGHT_SURCHARGE: 1, HOLIDAY_OVERTIME_DAY: 1 });
	expect(amountOf('DAYS_WORKED', settlement)).toBe(350181);
	expect(amountOf('SUNDAY_REST', settlement)).toBe(58364);
	expect(amountOf('TRANSPORT_ALLOWANCE', settlement)).toBe(49819);
	expect(amountOf('OVERTIME_DAY', settlement)).toBe(10422);
	expect(amountOf('NIGHT_SURCHARGE', settlement)).toBe(2918);
	expect(amountOf('HOLIDAY_OVERTIME_DAY', settlement)).toBe(17926);
});

test('the contribution base leaves out the transport allowance and the non-salary bonus', () => {
	const settlement = settle({}, { nonSalaryBonus: 50000 });
	expect(settlement.contributionBase).toBe(350181 + 58364);
	expect(settlement.contributionBase).not.toBe(settlement.totalEarnings);
	expect(settlement.deductions).toEqual([
		{ concept: 'PENSION', amount: 16342 },
		{ concept: 'HEALTH', amount: 16342 },
		{ concept: 'LOANS', amount: 0 },
		{ concept: 'OTHER', amount: 0 }
	]);
});

test('the printed lines add up exactly to the printed totals, all in whole pesos', () => {
	const settlement = settle(
		{
			OVERTIME_DAY: 2.5,
			OVERTIME_NIGHT: 1.25,
			HOLIDAY_OVERTIME_DAY: 3,
			HOLIDAY_OVERTIME_NIGHT: 0.5,
			NIGHT_SURCHARGE: 4.75
		},
		{ nonSalaryBonus: 30000, loans: 20000, other: 15000 }
	);
	const sum = (lines: { amount: number }[]) =>
		lines.reduce((total, { amount }) => total + amount, 0);
	expect(settlement.earnings).toHaveLength(9);
	expect(sum(settlement.earnings)).toBe(settlement.totalEarnings);
	expect(sum(settlement.deductions)).toBe(settlement.totalDeductions);
	expect(settlement.netPay).toBe(settlement.totalEarnings - settlement.totalDeductions);
	const amounts = [...settlement.earnings, ...settlement.deductions].map(({ amount }) => amount);
	expect(amounts.every(Number.isInteger)).toBe(true);
});

test('each hours factor comes from the settings: changing one changes only its line', () => {
	const factors: Record<HourConcept, keyof PayrollParameters> = {
		HOLIDAY_OVERTIME_DAY: 'PAYROLL_HOLIDAY_OVERTIME_DAY_FACTOR',
		HOLIDAY_OVERTIME_NIGHT: 'PAYROLL_HOLIDAY_OVERTIME_NIGHT_FACTOR',
		OVERTIME_DAY: 'PAYROLL_OVERTIME_DAY_FACTOR',
		OVERTIME_NIGHT: 'PAYROLL_OVERTIME_NIGHT_FACTOR',
		NIGHT_SURCHARGE: 'PAYROLL_NIGHT_SURCHARGE_FACTOR'
	};
	const oneHourEach = Object.fromEntries(Object.keys(factors).map((concept) => [concept, 1]));
	const before = settle(oneHourEach);
	for (const [concept, key] of Object.entries(factors) as [
		HourConcept,
		keyof PayrollParameters
	][]) {
		const after = settle(oneHourEach, {}, { ...DEFAULTS, [key]: DEFAULTS[key] + 100 });
		const changed = after.earnings.filter((line, i) => line.amount !== before.earnings[i].amount);
		expect(changed.map((line) => line.concept)).toEqual([concept]);
	}
});

test('the extra-hours range runs from the Saturday before the period to its Friday', () => {
	// The week of Monday 12 Oct 2026: its salary period ends Saturday 17.
	expect(getExtraHoursRange('2026-10-12')).toEqual({ start: '2026-10-10', end: '2026-10-16' });
});

test("a week's Saturday and Sunday hours land in the next week's settlement", () => {
	const isIn = (date: string, range: { start: string; end: string }) =>
		range.start <= date && date <= range.end;
	const thisWeek = getExtraHoursRange('2026-10-12');
	const nextWeek = getExtraHoursRange('2026-10-19');
	for (const weekend of ['2026-10-17', '2026-10-18']) {
		expect(isIn(weekend, thisWeek)).toBe(false);
		expect(isIn(weekend, nextWeek)).toBe(true);
	}
});

test('the range depends only on the period, not on when the payment is recorded', () => {
	// Paying at 6 p.m. on Saturday 17 doesn't pull that Saturday in: the range takes no time at all.
	expect(getExtraHoursRange.length).toBe(1);
	expect(getExtraHoursRange('2026-10-12').end).toBe('2026-10-16');
});
