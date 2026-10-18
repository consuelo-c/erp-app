// Weekly settlements, one employee at a time, for ADMIN and MANAGER. While it's a draft, opening
// and saving recalculate it: the five hours rows from the hours log, every amount from the current
// settings and salary. Opening only shows it; saving writes it with the snapshots of that moment,
// final once the payment is recorded (PAID).

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { addDays, getTodaysDate, getWeekStart } from '$lib/datetime';
import { SETTINGS } from '$lib/settings';
import { requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate, type Row } from '../audit';
import { deriveOvertime, type DayPunches, type OvertimeMinutes } from '../overtime';
import {
	calculateSettlement,
	getExtraHoursRange,
	parsePesos,
	parseQuantity,
	roundToMinute,
	type DeductionConcept,
	type EarningConcept,
	type HourConcept,
	type PayrollParameters,
	type QuantityConcept
} from '$lib/payroll';
import { getEmployee, listEmployees, type Employee } from './employees';
import { readSettings, type SettingValues } from './settings';

const SETTLES_PAYROLL = ['ADMIN', 'MANAGER'] as const;

// Everything the calculation and the derivation read: `settings_snapshot` keeps exactly these.
const PAYROLL_SETTINGS = [
	'PAYROLL_DAYS_PER_MONTH',
	'PAYROLL_HOURS_PER_MONTH',
	'PAYROLL_TRANSPORT_ALLOWANCE',
	'PAYROLL_HOLIDAY_OVERTIME_DAY_FACTOR',
	'PAYROLL_HOLIDAY_OVERTIME_NIGHT_FACTOR',
	'PAYROLL_OVERTIME_DAY_FACTOR',
	'PAYROLL_OVERTIME_NIGHT_FACTOR',
	'PAYROLL_NIGHT_SURCHARGE_FACTOR',
	'PAYROLL_PENSION_RATE',
	'PAYROLL_HEALTH_RATE',
	'PAYROLL_ORDINARY_HOURS_PER_DAY',
	'PAYROLL_NIGHT_START',
	'PAYROLL_NIGHT_END',
	'PAYROLL_HOLIDAYS'
] as const;
type PayrollSettings = SettingValues<(typeof PAYROLL_SETTINGS)[number]>;

// Each hours row and the derivation's row it comes from.
const DERIVED_ROWS: Record<HourConcept, keyof OvertimeMinutes> = {
	HOLIDAY_OVERTIME_DAY: 'daytimeHolidayOvertime',
	HOLIDAY_OVERTIME_NIGHT: 'nightHolidayOvertime',
	OVERTIME_DAY: 'daytimeOvertime',
	OVERTIME_NIGHT: 'nightOvertime',
	NIGHT_SURCHARGE: 'nightSurcharge'
};
const HOUR_CONCEPTS = Object.keys(DERIVED_ROWS) as HourConcept[];
const EARNING_CONCEPTS = [
	'DAYS_WORKED',
	'SUNDAY_REST',
	'HOLIDAY_OVERTIME_DAY',
	'HOLIDAY_OVERTIME_NIGHT',
	'OVERTIME_DAY',
	'OVERTIME_NIGHT',
	'NIGHT_SURCHARGE',
	'TRANSPORT_ALLOWANCE',
	'NON_SALARY_BONUS'
] as const satisfies readonly EarningConcept[];
const QUANTITY_CONCEPTS = EARNING_CONCEPTS.filter(
	(concept): concept is QuantityConcept => 'NON_SALARY_BONUS' !== concept
);
const DEDUCTION_CONCEPTS = [
	'PENSION',
	'HEALTH',
	'LOANS',
	'OTHER'
] as const satisfies readonly DeductionConcept[];

// A new draft's typed-in days: six worked, Sunday's rest, and the allowance for the six.
const DEFAULT_DAYS = { DAYS_WORKED: 6, SUNDAY_REST: 1, TRANSPORT_ALLOWANCE: 6 };

// Hours rows are whole minutes, kept as hours: shown with two decimals, which map back to the
// exact minute, so an untouched row never reads as corrected.
const MINUTES_PER_HOUR = 60;
const DAYS_PER_PERIOD = 6; // Monday to Saturday

const earningsSchema = z.array(
	z.object({
		concept: z.enum(EARNING_CONCEPTS),
		qty: z.number().nonnegative().optional(),
		derived_qty: z.number().nonnegative().optional(),
		amount: z.number().int().nonnegative()
	})
);
const deductionsSchema = z.array(
	z.object({
		concept: z.enum(DEDUCTION_CONCEPTS),
		amount: z.number().int().nonnegative(),
		description: z.string().min(1).optional()
	})
);

// A settlement's lines as stored, and its totals.
type Computed = {
	earnings: z.infer<typeof earningsSchema>;
	deductions: z.infer<typeof deductionsSchema>;
	totalEarnings: number;
	totalDeductions: number;
	netPay: number;
};
type StoredEarning = Computed['earnings'][number];

// Each setting as `settings` stores it, TEXT, so its own key's schema reads it back.
const snapshotSchema = z.object(
	Object.fromEntries(PAYROLL_SETTINGS.map((key) => [key, SETTINGS[key].schema]))
);

export type EarningRow = {
	concept: EarningConcept;
	qty: number | null;
	// Hours rows only: the hours log's value, shown next to a corrected `qty`.
	derivedQty: number | null;
	amount: number;
};
export type DeductionRow = {
	concept: DeductionConcept;
	amount: number;
	description: string | null;
};

export type Draft = {
	employeeId: number;
	status: 'DRAFT' | 'PAID';
	isSaved: boolean;
	weekNumber: number;
	// The number the proposal added one to; null when it's 1: the first of the year.
	previousWeekNumber: number | null;
	paymentDate: string;
	earnings: EarningRow[];
	deductions: DeductionRow[];
	totalEarnings: number;
	totalDeductions: number;
	netPay: number;
	// What the screen recalculates with as it's typed, the same way saving does.
	monthlySalary: number;
	parameters: PayrollParameters;
	// Pre-fills «Cuenta» for a transfer.
	employeeBankAccount: string | null;
	// Paid only: the movement recorded, and who the settlement was for when it was paid.
	payment: Payment | null;
};

export type Payment = {
	method: PaymentMethod;
	amount: number;
	movementDate: string;
	bankAccount: string | null;
	notes: string | null;
	recordedBy: string;
	employeeName: string;
	employeePosition: string | null;
};

type Period = {
	periodStart: string;
	periodEnd: string;
	extraHours: { start: string; end: string };
};

export type PayrollWeek = Period & {
	employees: { id: number; fullName: string; position: string }[];
	draft: Draft | null;
};

export type SaveResult =
	{ ok: true } | { ok: false; message: string; errors: Record<string, string> };

// What a draft keeps between saves: the quantities, the three typed amounts and their descriptions.
type Entries = {
	quantities: Record<QuantityConcept, number>;
	nonSalaryBonus: number;
	loans: number;
	other: number;
	loansDescription: string | null;
	otherDescription: string | null;
};

const RUN_COLUMNS = [
	'week_number',
	'period_end',
	'payment_date',
	'employee_name',
	'employee_id_number',
	'employee_position',
	'employee_hire_date',
	'prepared_by',
	'earnings',
	'deductions',
	'settings_snapshot',
	'total_earnings',
	'total_deductions',
	'net_pay'
] as const;
type RunRow = Record<(typeof RUN_COLUMNS)[number], string | number | null> & {
	id: number;
	status: 'DRAFT' | 'PAID';
};

const dateSchema = z.iso.date();
const idSchema = z.coerce.number().int().positive();

function toPeriod(periodStart: string): Period {
	return {
		periodStart,
		periodEnd: addDays(periodStart, DAYS_PER_PERIOD - 1),
		extraHours: getExtraHoursRange(periodStart)
	};
}

/** `week` is any date of the week; this week by default, and never a later one. */
function findPeriod(week: unknown): Period {
	const today = getTodaysDate();
	const date = dateSchema.catch(today).parse(week ?? today);
	return toPeriod(getWeekStart(date > today ? today : date));
}

// Employed at some point between the Saturday whose hours it pays and the period's end.
function worksDuring(employee: Employee, { extraHours, periodEnd }: Period): boolean {
	return employee.employment.some(
		(period) => period.start <= periodEnd && (null === period.end || extraHours.start <= period.end)
	);
}

async function findPunches(
	db: D1Database,
	employeeId: number,
	{ start, end }: Period['extraHours']
): Promise<DayPunches[]> {
	const { results } = await db
		.prepare(
			`select work_date as workDate, morning_in as morningIn, morning_out as morningOut,
			afternoon_in as afternoonIn, afternoon_out as afternoonOut
			from timesheets where employee_id = ? and work_date between ? and ?`
		)
		.bind(employeeId, start, end)
		.all<DayPunches>();
	return results;
}

/** The five hours rows of the extra-hours range's punches, in hours. */
function deriveHours(days: DayPunches[], settings: PayrollSettings): Record<HourConcept, number> {
	const minutes = Object.fromEntries(HOUR_CONCEPTS.map((concept) => [concept, 0]));
	for (const day of days) {
		const isHoliday = settings.PAYROLL_HOLIDAYS.some((holiday) => day.workDate === holiday.date);
		const overtime = deriveOvertime(day, isHoliday, settings);
		for (const concept of HOUR_CONCEPTS) {
			minutes[concept] += overtime[DERIVED_ROWS[concept]];
		}
	}
	return Object.fromEntries(
		HOUR_CONCEPTS.map((concept) => [concept, minutes[concept] / MINUTES_PER_HOUR])
	) as Record<HourConcept, number>;
}

// What a calculation reads besides the entries.
type Context = {
	employee: Employee;
	derived: Record<HourConcept, number>;
	settings: PayrollSettings;
};

function calculate(entries: Entries, { employee, derived, settings }: Context): Computed {
	const settlement = calculateSettlement(
		{ monthlySalary: employee.monthlySalary, ...entries },
		settings
	);
	const descriptions: Partial<Record<DeductionConcept, string | null>> = {
		LOANS: entries.loansDescription,
		OTHER: entries.otherDescription
	};
	const earnings = earningsSchema.parse(
		settlement.earnings.map((line) =>
			line.concept in DERIVED_ROWS
				? { ...line, derived_qty: derived[line.concept as HourConcept] }
				: line
		)
	);
	const deductions = deductionsSchema.parse(
		settlement.deductions.map((line) => ({
			...line,
			description: descriptions[line.concept] ?? undefined
		}))
	);
	const { totalEarnings, totalDeductions, netPay } = settlement;
	return { earnings, deductions, totalEarnings, totalDeductions, netPay };
}

function readStored(row: RunRow): Computed {
	return {
		earnings: earningsSchema.parse(JSON.parse(String(row.earnings))),
		deductions: deductionsSchema.parse(JSON.parse(String(row.deductions))),
		totalEarnings: Number(row.total_earnings),
		totalDeductions: Number(row.total_deductions),
		netPay: Number(row.net_pay)
	};
}

// A corrected row keeps what the manager typed; an untouched one takes the hours log's value.
function readQuantity(line: StoredEarning | undefined, derived: Record<HourConcept, number>) {
	if (undefined === line) {
		return 0;
	}
	const isUntouched = line.concept in DERIVED_ROWS && line.derived_qty === line.qty;
	return isUntouched ? derived[line.concept as HourConcept] : (line.qty ?? 0);
}

function readEntries(row: RunRow, derived: Record<HourConcept, number>): Entries {
	const { earnings, deductions } = readStored(row);
	const find = <Line extends { concept: string }>(lines: Line[], concept: string) =>
		lines.find((line) => concept === line.concept);
	const amountOf = (lines: { concept: string; amount: number }[], concept: string) =>
		find(lines, concept)?.amount ?? 0;
	const descriptionOf = (concept: DeductionConcept) =>
		find(deductions, concept)?.description ?? null;
	return {
		quantities: Object.fromEntries(
			QUANTITY_CONCEPTS.map((concept) => [concept, readQuantity(find(earnings, concept), derived)])
		) as Record<QuantityConcept, number>,
		nonSalaryBonus: amountOf(earnings, 'NON_SALARY_BONUS'),
		loans: amountOf(deductions, 'LOANS'),
		other: amountOf(deductions, 'OTHER'),
		loansDescription: descriptionOf('LOANS'),
		otherDescription: descriptionOf('OTHER')
	};
}

function newEntries(derived: Record<HourConcept, number>): Entries {
	return {
		quantities: { ...DEFAULT_DAYS, ...derived },
		nonSalaryBonus: 0,
		loans: 0,
		other: 0,
		loansDescription: null,
		otherDescription: null
	};
}

async function findRun(db: D1Database, employeeId: number, periodStart: string) {
	return db
		.prepare(
			`select id, status, ${RUN_COLUMNS.join(', ')} from payroll_runs where employee_id = ? and period_start = ?`
		)
		.bind(employeeId, periodStart)
		.first<RunRow>();
}

/** The company's own count: the latest earlier settlement's + 1, back to 1 in January. */
async function proposeWeekNumber(db: D1Database, { periodStart, periodEnd }: Period) {
	const previous = await db
		.prepare(
			'select week_number, period_end from payroll_runs where period_start < ? order by period_start desc, week_number desc limit 1'
		)
		.bind(periodStart)
		.first<{ week_number: number; period_end: string }>();
	const isSameYear = previous?.period_end.slice(0, 4) === periodEnd.slice(0, 4);
	return null !== previous && isSameYear
		? { weekNumber: previous.week_number + 1, previousWeekNumber: previous.week_number }
		: { weekNumber: 1, previousWeekNumber: null };
}

function findById(employees: Employee[], employeeId: unknown): Employee | undefined {
	const id = idSchema.safeParse(employeeId);
	return employees.find((candidate) => id.success && id.data === candidate.id);
}

// The employee asked for must have worked the period: showing someone else instead is how the
// wrong person gets paid. The one preferred, picked earlier, is only kept if they did.
function pickEmployee(employees: Employee[], input: EmployeeChoice): Employee {
	if (null === input.employeeId || undefined === input.employeeId) {
		return findById(employees, input.preferredEmployeeId) ?? employees[0];
	}
	const employee = findById(employees, input.employeeId);
	if (undefined === employee) {
		error(404, 'Ese empleado no trabajó en este periodo');
	}
	return employee;
}

function toDraft(
	run: Computed,
	details: Omit<Draft, keyof Computed | 'parameters'>,
	settings: PayrollSettings
): Draft {
	return {
		...details,
		earnings: run.earnings.map((line) => ({
			concept: line.concept,
			qty: line.qty ?? null,
			derivedQty: line.derived_qty ?? null,
			amount: line.amount
		})),
		deductions: run.deductions.map((line) => ({
			concept: line.concept,
			amount: line.amount,
			description: line.description ?? null
		})),
		totalEarnings: run.totalEarnings,
		totalDeductions: run.totalDeductions,
		netPay: run.netPay,
		parameters: settings
	};
}

type EmployeeChoice = { employeeId: unknown; preferredEmployeeId?: unknown };

/**
 * The week's employees and one of them's settlement (`employeeId`; otherwise `preferredEmployeeId`
 * if they worked the period, or the first one): the saved draft recalculated, or a new one proposed
 * from the hours log. Opening writes nothing.
 */
export async function openWeek(
	db: D1Database,
	input: EmployeeChoice & { week: unknown },
	actor: Actor | null
): Promise<PayrollWeek> {
	requireRole(actor, SETTLES_PAYROLL);
	const period = findPeriod(input.week);
	const employees = (await listEmployees(db, actor)).filter((each) => worksDuring(each, period));
	const options = employees.map(({ id, fullName, position }) => ({ id, fullName, position }));
	if (0 === employees.length) {
		return { ...period, employees: options, draft: null };
	}
	const employee = pickEmployee(employees, input);
	return { ...period, employees: options, draft: await buildDraft(db, employee, period) };
}

async function buildDraft(db: D1Database, employee: Employee, period: Period): Promise<Draft> {
	const [settings, row, proposal, days] = await Promise.all([
		readSettings(db, PAYROLL_SETTINGS),
		findRun(db, employee.id, period.periodStart),
		proposeWeekNumber(db, period),
		findPunches(db, employee.id, period.extraHours)
	]);
	const context = { employee, settings, derived: deriveHours(days, settings) };
	const details = {
		employeeId: employee.id,
		previousWeekNumber: proposal.previousWeekNumber,
		monthlySalary: employee.monthlySalary,
		employeeBankAccount: employee.bankAccount
	};
	if (null === row) {
		const run = calculate(newEntries(context.derived), context);
		const proposed = { weekNumber: proposal.weekNumber, paymentDate: period.periodEnd };
		const fresh = { status: 'DRAFT', isSaved: false, payment: null } as const;
		return toDraft(run, { ...details, ...proposed, ...fresh }, settings);
	}
	// A paid settlement is frozen: it shows what was stored, never a recalculation.
	const run =
		'PAID' === row.status ? readStored(row) : calculate(readEntries(row, context.derived), context);
	const saved = { weekNumber: Number(row.week_number), paymentDate: String(row.payment_date) };
	const payment = await findPayment(db, row);
	return toDraft(
		run,
		{ ...details, ...saved, status: row.status, isSaved: true, payment },
		settings
	);
}

type MovementRow = {
	payment_method: PaymentMethod;
	amount: number;
	movement_date: string;
	bank_account: string | null;
	notes: string | null;
	created_by: string;
};

async function findPayment(db: D1Database, row: RunRow): Promise<Payment | null> {
	if ('PAID' !== row.status) {
		return null;
	}
	const movement = await db
		.prepare(
			`select payment_method, amount, movement_date, bank_account, notes, created_by
			from cash_movements where payroll_run_id = ? and concept = 'PAYROLL'`
		)
		.bind(row.id)
		.first<MovementRow>();
	if (null === movement) {
		throw new Error(`Paid settlement ${row.id} has no PAYROLL movement`);
	}
	return {
		method: movement.payment_method,
		amount: -movement.amount,
		movementDate: movement.movement_date,
		bankAccount: movement.bank_account,
		notes: movement.notes,
		recordedBy: movement.created_by,
		employeeName: String(row.employee_name),
		employeePosition: null === row.employee_position ? null : String(row.employee_position)
	};
}

const QUANTITY_MESSAGE = 'Escribe una cantidad de 0 en adelante';
const quantitySchema = z
	.string()
	.transform(parseQuantity)
	.pipe(z.number(QUANTITY_MESSAGE).nonnegative(QUANTITY_MESSAGE));
const pesosSchema = z.string().transform(parsePesos);
const descriptionSchema = z
	.string()
	.trim()
	.optional()
	.transform((value) => value || null);

const WEEK_MESSAGE = 'Escribe el número de la semana, de 1 a 53';
const draftShape = {
	employee_id: idSchema,
	period_start: dateSchema.refine((date) => getWeekStart(date) === date),
	week_number: z.coerce
		.number(WEEK_MESSAGE)
		.int(WEEK_MESSAGE)
		.min(1, WEEK_MESSAGE)
		.max(53, WEEK_MESSAGE),
	payment_date: z.iso.date('Escoge la fecha de pago'),
	...Object.fromEntries(QUANTITY_CONCEPTS.map((concept) => [concept, quantitySchema])),
	NON_SALARY_BONUS: pesosSchema,
	LOANS: pesosSchema,
	OTHER: pesosSchema,
	'LOANS.description': descriptionSchema,
	'OTHER.description': descriptionSchema
};
// The worker signs for every deduction: one they can't identify isn't saved.
const OTHER_DESCRIBED = {
	check: (form: { OTHER: number; 'OTHER.description': string | null }) =>
		0 === form.OTHER || null !== form['OTHER.description'],
	params: {
		path: ['OTHER.description'],
		message: 'Escribe la descripción. «Otros» no se guarda sin ella.'
	}
};
const saveSchema = z.object(draftShape).refine(OTHER_DESCRIBED.check, OTHER_DESCRIBED.params);
type SaveForm = z.infer<typeof saveSchema> & Record<QuantityConcept, number>;

export const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// The draft as typed plus how it's paid: a transfer names the account, «Otro» says which method.
const paymentSchema = z
	.object({
		...draftShape,
		payment_method: z.enum(PAYMENT_METHODS, 'Escoge el medio de pago'),
		bank_account: descriptionSchema,
		payment_method_other: descriptionSchema
	})
	.refine(OTHER_DESCRIBED.check, OTHER_DESCRIBED.params)
	.refine((form) => 'TRANSFER' !== form.payment_method || null !== form.bank_account, {
		path: ['bank_account'],
		message: 'Escribe la cuenta a la que se transfiere'
	})
	.refine((form) => 'OTHER' !== form.payment_method || null !== form.payment_method_other, {
		path: ['payment_method_other'],
		message: 'Escribe cuál medio de pago se usó'
	});
type PaymentForm = z.infer<typeof paymentSchema> & SaveForm;

function readForm(form: SaveForm): Entries {
	// Typed hours land on the minute, like the derived ones.
	const quantity = (concept: QuantityConcept) =>
		concept in DERIVED_ROWS ? roundToMinute(form[concept]) : form[concept];
	return {
		quantities: Object.fromEntries(
			QUANTITY_CONCEPTS.map((concept) => [concept, quantity(concept)])
		) as Record<QuantityConcept, number>,
		nonSalaryBonus: form.NON_SALARY_BONUS,
		loans: form.LOANS,
		other: form.OTHER,
		loansDescription: form['LOANS.description'],
		otherDescription: form['OTHER.description']
	};
}

function invalid(error: z.ZodError): SaveResult {
	const errors = Object.fromEntries(
		error.issues.map((issue) => [String(issue.path[0]), issue.message])
	);
	return { ok: false, message: 'Revisa los campos marcados en rojo antes de guardar.', errors };
}

function refuse(message: string): SaveResult {
	return { ok: false, message, errors: {} };
}

function toSnapshot(settings: PayrollSettings): string {
	const texts = Object.fromEntries(
		Object.entries(settings).map(([key, value]) => [
			key,
			'string' === typeof value ? value : JSON.stringify(value)
		])
	);
	snapshotSchema.parse(texts);
	return JSON.stringify(texts);
}

/**
 * Creates or updates the employee's draft for the week: recalculated from the form, the hours log
 * and the current settings, with the snapshots of this moment. A paid settlement is never written.
 */
export async function saveDraft(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, SETTLES_PAYROLL);
	const parsed = saveSchema.safeParse(input);
	return parsed.success ? writeDraft(db, parsed.data as SaveForm, actor) : invalid(parsed.error);
}

/**
 * Saves the form as the draft and records its payment, in that order: what's paid is what's on
 * screen. One batch marks it PAID, frozen from then on, and writes its `PAYROLL` movement.
 */
export async function recordPayment(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, SETTLES_PAYROLL);
	const parsed = paymentSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const form = parsed.data as PaymentForm;
	const saved = await writeDraft(db, form, actor);
	if (!saved.ok) {
		return saved;
	}
	// ponytail: two payments racing past the DRAFT check both write a movement; one manager pays.
	const row = (await findRun(db, form.employee_id, form.period_start))!;
	await db.batch(payStatements(db, actor, { form, row }));
	return { ok: true };
}

// The three things recording a payment does, in one batch: PAID, frozen, and its movement.
function payStatements(
	db: D1Database,
	actor: Actor,
	{ form, row }: { form: PaymentForm; row: RunRow }
) {
	const paid = auditedUpdate(db, {
		table: 'payroll_runs',
		entityType: 'PAYROLL_RUN',
		actor,
		id: row.id,
		current: { status: row.status },
		changes: { status: 'PAID' },
		action: 'PAID'
	});
	const movement = { table: 'cash_movements', entityType: 'CASH_MOVEMENT', actor };
	return [...paid, ...auditedInsert(db, { ...movement, values: toMovement(form, row) })];
}

// The outflow: the net pay leaves on the payment date, to the account a transfer names.
function toMovement(form: PaymentForm, row: RunRow): Row {
	return {
		concept: 'PAYROLL',
		payment_method: form.payment_method,
		amount: -Number(row.net_pay),
		movement_date: String(row.payment_date),
		payroll_run_id: row.id,
		bank_account: 'TRANSFER' === form.payment_method ? form.bank_account : null,
		notes: 'OTHER' === form.payment_method ? form.payment_method_other : null
	};
}

async function writeDraft(db: D1Database, form: SaveForm, actor: Actor): Promise<SaveResult> {
	const target = await findTarget(db, form, actor);
	if ('string' === typeof target) {
		return refuse(target);
	}
	const save = { ...target, form, actor, settings: await readSettings(db, PAYROLL_SETTINGS) };
	const values = toColumns(save, await settle(db, save));
	const statements = writeStatements(db, actor, { ...target, values });
	if (0 < statements.length) {
		await db.batch(statements);
	}
	return { ok: true };
}

function writeStatements(
	db: D1Database,
	actor: Actor,
	{ employee, period, row, values }: Target & { values: Row }
) {
	const write = { table: 'payroll_runs', entityType: 'PAYROLL_RUN', actor };
	if (null === row) {
		const key = { employee_id: employee.id, period_start: period.periodStart };
		return auditedInsert(db, { ...write, values: { ...key, ...values } });
	}
	return auditedUpdate(db, { ...write, id: row.id, current: row, changes: values });
}

type Target = { employee: Employee; period: Period; row: RunRow | null };
type Save = Target & { form: SaveForm; actor: Actor; settings: PayrollSettings };

async function settle(db: D1Database, { employee, period, form, settings }: Save) {
	const days = await findPunches(db, employee.id, period.extraHours);
	return calculate(readForm(form), { employee, settings, derived: deriveHours(days, settings) });
}

/** The draft a save writes to, or why it can't. */
async function findTarget(db: D1Database, form: SaveForm, actor: Actor): Promise<Target | string> {
	const period = toPeriod(form.period_start);
	if (period.periodStart > getTodaysDate()) {
		return 'Ese periodo todavía no ha empezado';
	}
	const employee = await getEmployee(db, form.employee_id, actor);
	if (null === employee || !worksDuring(employee, period)) {
		return 'Ese empleado no trabajó en este periodo';
	}
	const row = await findRun(db, employee.id, period.periodStart);
	if ('PAID' === row?.status) {
		return 'Esta liquidación ya se pagó: no se puede cambiar';
	}
	return { employee, period, row };
}

// Every column a save writes but the two that identify the row.
function toColumns({ employee, period, form, settings, actor }: Save, run: Computed): Row {
	const hirePeriod = employee.employment.findLast((each) => each.start <= period.periodEnd);
	return {
		week_number: form.week_number,
		period_end: period.periodEnd,
		payment_date: form.payment_date,
		employee_name: employee.fullName,
		employee_id_number: employee.idNumber,
		employee_position: employee.position,
		employee_hire_date: hirePeriod?.start ?? null,
		prepared_by: actor.username,
		earnings: JSON.stringify(run.earnings),
		deductions: JSON.stringify(run.deductions),
		settings_snapshot: toSnapshot(settings),
		total_earnings: run.totalEarnings,
		total_deductions: run.totalDeductions,
		net_pay: run.netPay
	};
}
