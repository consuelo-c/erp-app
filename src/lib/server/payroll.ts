// Weekly payroll settlement: the derived rates, the nine earnings, the four deductions and the
// totals. Pure, no database: the caller passes the quantities and the settings values. Money is
// whole pesos: each line rounds to the peso as it's calculated, and every total sums rounded lines.

import { addDays } from '$lib/datetime';

/** The settings the calculation reads, keyed by setting, already parsed by `SETTINGS`. */
export type PayrollParameters = {
	PAYROLL_DAYS_PER_MONTH: number;
	PAYROLL_HOURS_PER_MONTH: number;
	PAYROLL_TRANSPORT_ALLOWANCE: number;
	PAYROLL_HOLIDAY_OVERTIME_DAY_FACTOR: number;
	PAYROLL_HOLIDAY_OVERTIME_NIGHT_FACTOR: number;
	PAYROLL_OVERTIME_DAY_FACTOR: number;
	PAYROLL_OVERTIME_NIGHT_FACTOR: number;
	PAYROLL_NIGHT_SURCHARGE_FACTOR: number;
	PAYROLL_PENSION_RATE: number;
	PAYROLL_HEALTH_RATE: number;
};

// Factors and rates are stored in whole hundredths: 125 means 1.25, 4 means 0.04.
const HUNDREDTHS = 100;

// The hours rows: every one pays the hour value times its factor. The night surcharge's 0.35 is
// only the surcharge, since its ordinary hour is already paid within the days worked.
const HOUR_FACTORS = {
	HOLIDAY_OVERTIME_DAY: 'PAYROLL_HOLIDAY_OVERTIME_DAY_FACTOR',
	HOLIDAY_OVERTIME_NIGHT: 'PAYROLL_HOLIDAY_OVERTIME_NIGHT_FACTOR',
	OVERTIME_DAY: 'PAYROLL_OVERTIME_DAY_FACTOR',
	OVERTIME_NIGHT: 'PAYROLL_OVERTIME_NIGHT_FACTOR',
	NIGHT_SURCHARGE: 'PAYROLL_NIGHT_SURCHARGE_FACTOR'
} as const satisfies Record<string, keyof PayrollParameters>;

export type HourConcept = keyof typeof HOUR_FACTORS;

/** The eight earnings with a quantity: days, or hours for the five hours rows. */
export type QuantityConcept = 'DAYS_WORKED' | 'SUNDAY_REST' | HourConcept | 'TRANSPORT_ALLOWANCE';
export type EarningConcept = QuantityConcept | 'NON_SALARY_BONUS';
export type DeductionConcept = 'PENSION' | 'HEALTH' | 'LOANS' | 'OTHER';

export type EarningLine = { concept: EarningConcept; qty?: number; amount: number };
export type DeductionLine = { concept: DeductionConcept; amount: number };

export type SettlementInput = {
	monthlySalary: number;
	quantities: Record<QuantityConcept, number>;
	// Typed in, in pesos.
	nonSalaryBonus: number;
	loans: number;
	other: number;
};

export type Settlement = {
	earnings: EarningLine[];
	deductions: DeductionLine[];
	contributionBase: number;
	totalEarnings: number;
	totalDeductions: number;
	netPay: number;
};

type Rates = { dayValue: number; hourValue: number };

/** The day and hour values of a monthly salary, unrounded: only the lines built on them round. */
export function deriveRates(monthlySalary: number, parameters: PayrollParameters): Rates {
	return {
		dayValue: monthlySalary / parameters.PAYROLL_DAYS_PER_MONTH,
		hourValue: monthlySalary / parameters.PAYROLL_HOURS_PER_MONTH
	};
}

/**
 * The extra-hours range a settlement pays, derived from its Monday `periodStart`: the Saturday
 * before it to the Friday of its week. The week's own Saturday and Sunday go to the next one.
 */
export function getExtraHoursRange(periodStart: string): { start: string; end: string } {
	return { start: addDays(periodStart, -2), end: addDays(periodStart, 4) };
}

function sumAmounts(lines: { amount: number }[]): number {
	return lines.reduce((total, line) => total + line.amount, 0);
}

function buildEarnings(input: SettlementInput, parameters: PayrollParameters): EarningLine[] {
	const { dayValue, hourValue } = deriveRates(input.monthlySalary, parameters);
	const dailyAllowance = parameters.PAYROLL_TRANSPORT_ALLOWANCE / parameters.PAYROLL_DAYS_PER_MONTH;
	const line = (concept: QuantityConcept, unitValue: number): EarningLine => {
		const qty = input.quantities[concept];
		return { concept, qty, amount: Math.round(unitValue * qty) };
	};
	const hourLines = (Object.keys(HOUR_FACTORS) as HourConcept[]).map((concept) =>
		line(concept, (hourValue * parameters[HOUR_FACTORS[concept]]) / HUNDREDTHS)
	);
	return [
		line('DAYS_WORKED', dayValue),
		line('SUNDAY_REST', dayValue),
		...hourLines,
		line('TRANSPORT_ALLOWANCE', dailyAllowance),
		{ concept: 'NON_SALARY_BONUS', amount: input.nonSalaryBonus }
	];
}

/** The contribution base (IBC): total earnings without the transport allowance and the bonus. */
function getContributionBase(earnings: EarningLine[]): number {
	const isContributory = ({ concept }: EarningLine) =>
		'TRANSPORT_ALLOWANCE' !== concept && 'NON_SALARY_BONUS' !== concept;
	return sumAmounts(earnings.filter(isContributory));
}

/** The week's nine earnings, four deductions and totals, each line rounded to the peso. */
export function calculateSettlement(
	input: SettlementInput,
	parameters: PayrollParameters
): Settlement {
	const earnings = buildEarnings(input, parameters);
	const contributionBase = getContributionBase(earnings);
	const contribution = (rate: number) => Math.round((contributionBase * rate) / HUNDREDTHS);
	const deductions: DeductionLine[] = [
		{ concept: 'PENSION', amount: contribution(parameters.PAYROLL_PENSION_RATE) },
		{ concept: 'HEALTH', amount: contribution(parameters.PAYROLL_HEALTH_RATE) },
		{ concept: 'LOANS', amount: input.loans },
		{ concept: 'OTHER', amount: input.other }
	];
	const totalEarnings = sumAmounts(earnings);
	const totalDeductions = sumAmounts(deductions);
	return {
		earnings,
		deductions,
		contributionBase,
		totalEarnings,
		totalDeductions,
		netPay: totalEarnings - totalDeductions
	};
}
