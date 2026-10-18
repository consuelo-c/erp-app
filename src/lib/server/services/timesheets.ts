// Hours punches: four a day per employee, typed by hand, never taken from the clock. One's own
// punches always go to the actor's employee, never one sent by the client; only ADMIN and MANAGER
// pick the employee, through the selector.

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { addDays, dialTimeShape, getTodaysDate, getWeekStart, toClockTime } from '$lib/datetime';
import { SETTINGS } from '$lib/settings';
import { requireRole, ROLES, type Actor } from '../actor';
import { auditedInsert, auditedUpdate } from '../audit';
import { countWorkedMinutes, deriveOvertime } from '../overtime';
import { employmentSchema } from './employees';

const PUNCH_COLUMNS = {
	morningIn: 'morning_in',
	morningOut: 'morning_out',
	afternoonIn: 'afternoon_in',
	afternoonOut: 'afternoon_out'
} as const;

export type Punch = keyof typeof PUNCH_COLUMNS;
export type Punches = Record<Punch, string | null>;

export type TimesheetDay = {
	workDate: string;
	punches: Punches;
	workedMinutes: number;
	isPaid: boolean;
	isFuture: boolean;
	// Inside one of the employee's employment periods: outside them, no punch is taken.
	isEmployed: boolean;
};

export type Result = { ok: true } | { ok: false; message: string };

type Period = z.infer<typeof employmentSchema>[number];
type HoursEmployee = { id: number; fullName: string; employment: Period[] };
export type Hours = {
	employeeId: number;
	employeeName: string;
	day: TimesheetDay;
	week: TimesheetDay[];
};
type TimesheetRow = Punches & { id: number; workDate: string };

const NO_PUNCHES: Punches = {
	morningIn: null,
	morningOut: null,
	afternoonIn: null,
	afternoonOut: null
};
const DAYS_PER_WEEK = 7;

// Only the periods matter here; the rest of the attributes (salary) never leaves employees.ts.
const employmentAttributesSchema = z.object({ employment: employmentSchema });

const punchKeys = Object.keys(PUNCH_COLUMNS) as [Punch, ...Punch[]];
// Stored as `HH:MM`.
const saveSchema = z
	.object({
		work_date: z.iso.date('Escoge el día'),
		punch: z.enum(punchKeys),
		...dialTimeShape
	})
	.transform(({ hour, minute, period, ...rest }) => ({
		...rest,
		time: toClockTime({ hour, minute, period })
	}));

const dateSchema = z.iso.date();
const employeeIdSchema = z.coerce.number().int().positive();
const employeeChoiceSchema = z.object({ employee_id: employeeIdSchema });

// Logging hours for anyone: the selector's employee is trusted only for them.
const LOGS_EVERYONES_HOURS = ['ADMIN', 'MANAGER'] as const;

const NO_EMPLOYEE: Result = { ok: false, message: 'Tu usuario no está vinculado a un empleado' };
const OUT_OF_ORDER: Result = {
	ok: false,
	message: 'Las marcas deben ir en orden: inicio y finalización de la mañana, luego de la tarde'
};

async function findEmployee(db: D1Database, id: number | null): Promise<HoursEmployee | null> {
	if (null === id) {
		return null;
	}
	const row = await db
		.prepare('select id, full_name, attributes from employees where id = ?')
		.bind(id)
		.first<{ id: number; full_name: string; attributes: string }>();
	if (null === row) {
		return null;
	}
	const { employment } = employmentAttributesSchema.parse(JSON.parse(row.attributes));
	return { id: row.id, fullName: row.full_name, employment };
}

function isWithinEmployment(employment: Period[], date: string): boolean {
	return employment.some(
		(period) => period.start <= date && (null === period.end || date <= period.end)
	);
}

// STUB: Phase 06 (#140). Settlements don't exist yet, so no day is paid. Phase 06 replaces it
// with the PAID settlement of this employee whose extra-hours range covers `workDate`.
type EmployeeDay = { employeeId: number; workDate: string };

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the stub ignores what Phase 06 reads
async function isDayPaid(db: D1Database, day: EmployeeDay): Promise<boolean> {
	return false;
}

const SELECT_ROWS = `select id, work_date as workDate, morning_in as morningIn, morning_out as morningOut,
	afternoon_in as afternoonIn, afternoon_out as afternoonOut from timesheets`;

async function findRows(
	db: D1Database,
	employeeId: number,
	dates: string[]
): Promise<TimesheetRow[]> {
	const { results } = await db
		.prepare(`${SELECT_ROWS} where employee_id = ? and work_date between ? and ?`)
		.bind(employeeId, dates[0], dates.at(-1))
		.all<TimesheetRow>();
	return results;
}

async function buildDays(
	db: D1Database,
	{ id: employeeId, employment }: HoursEmployee,
	dates: string[]
): Promise<TimesheetDay[]> {
	const rows = await findRows(db, employeeId, dates);
	const today = getTodaysDate();
	return Promise.all(
		dates.map(async (workDate) => {
			const row = rows.find((candidate) => workDate === candidate.workDate);
			const punches: Punches = { ...NO_PUNCHES, ...pickPunches(row) };
			const isPaid = await isDayPaid(db, { employeeId, workDate });
			const workedMinutes = countWorkedMinutes(punches);
			return {
				workDate,
				punches,
				workedMinutes,
				isPaid,
				isFuture: workDate > today,
				isEmployed: isWithinEmployment(employment, workDate)
			};
		})
	);
}

function pickPunches(row: TimesheetRow | undefined): Partial<Punches> {
	if (undefined === row) {
		return {};
	}
	const { morningIn, morningOut, afternoonIn, afternoonOut } = row;
	return { morningIn, morningOut, afternoonIn, afternoonOut };
}

type HoursInput = { date: string; week?: string | null };

/**
 * The actor's own day and the week shown under it (the day's week unless `week` names another).
 * Null when the login has no employee: it can't punch. A future or malformed day is a 404.
 */
export async function getOwnHours(
	db: D1Database,
	input: HoursInput,
	actor: Actor | null
): Promise<Hours | null> {
	requireRole(actor, ROLES);
	const employee = await findEmployee(db, actor.employeeId);
	return null === employee ? null : buildHours(db, employee, input);
}

/** Any employee's day and week, for ADMIN and MANAGER. An unknown employee is a 404. */
export async function getEmployeeHours(
	db: D1Database,
	input: HoursInput & { employeeId: unknown },
	actor: Actor | null
): Promise<Hours> {
	requireRole(actor, LOGS_EVERYONES_HOURS);
	const id = employeeIdSchema.safeParse(input.employeeId);
	const employee = id.success ? await findEmployee(db, id.data) : null;
	if (null === employee) {
		error(404, 'Ese empleado no existe');
	}
	return buildHours(db, employee, input);
}

async function buildHours(
	db: D1Database,
	employee: HoursEmployee,
	input: HoursInput
): Promise<Hours> {
	const date = dateSchema.safeParse(input.date);
	if (!date.success || date.data > getTodaysDate()) {
		error(404, 'Ese día no existe');
	}
	const weekStart = getWeekStart(dateSchema.catch(date.data).parse(input.week ?? date.data));
	const weekDates = Array.from({ length: DAYS_PER_WEEK }, (_, offset) =>
		addDays(weekStart, offset)
	);
	const [[day], week] = await Promise.all([
		buildDays(db, employee, [date.data]),
		buildDays(db, employee, weekDates)
	]);
	return { employeeId: employee.id, employeeName: employee.fullName, day, week };
}

// Within a block the clock-out comes after the clock-in; between blocks, the afternoon may start
// the minute the morning ends. `HH:MM` strings compare in time order.
function arePunchesInOrder(punches: Punches): boolean {
	const present = Object.values(punches).filter((time) => null !== time);
	const isSorted = present.every((time, i) => 0 === i || time >= present[i - 1]);
	const isForward = (clockIn: string | null, clockOut: string | null) =>
		null === clockIn || null === clockOut || clockOut > clockIn;
	return (
		isSorted &&
		isForward(punches.morningIn, punches.morningOut) &&
		isForward(punches.afternoonIn, punches.afternoonOut)
	);
}

async function findRefusal(
	db: D1Database,
	employee: HoursEmployee,
	workDate: string
): Promise<string | null> {
	if (workDate > getTodaysDate()) {
		return 'Ese día todavía no ha llegado';
	}
	if (!isWithinEmployment(employee.employment, workDate)) {
		return 'Ese día no hace parte de ningún período laboral';
	}
	if (await isDayPaid(db, { employeeId: employee.id, workDate })) {
		return 'Ese día ya se pagó en la nómina: no se puede cambiar';
	}
	return null;
}

type PunchChange = { employee: HoursEmployee; workDate: string; punch: Punch; time: string };

function writeStatements(
	db: D1Database,
	actor: Actor,
	{ row, ...change }: PunchChange & { row: TimesheetRow | null }
) {
	const column = PUNCH_COLUMNS[change.punch];
	if (null === row) {
		const values = {
			employee_id: change.employee.id,
			work_date: change.workDate,
			[column]: change.time
		};
		return auditedInsert(db, { table: 'timesheets', entityType: 'TIMESHEET', actor, values });
	}
	return auditedUpdate(db, {
		table: 'timesheets',
		entityType: 'TIMESHEET',
		actor,
		id: row.id,
		current: { [column]: row[change.punch] },
		changes: { [column]: change.time }
	});
}

async function savePunch(db: D1Database, actor: Actor, change: PunchChange): Promise<Result> {
	const refusal = await findRefusal(db, change.employee, change.workDate);
	if (null !== refusal) {
		return { ok: false, message: refusal };
	}
	const [row = null] = await findRows(db, change.employee.id, [change.workDate]);
	if (
		!arePunchesInOrder({
			...NO_PUNCHES,
			...pickPunches(row ?? undefined),
			[change.punch]: change.time
		})
	) {
		return OUT_OF_ORDER;
	}
	const statements = writeStatements(db, actor, { ...change, row });
	if (0 < statements.length) {
		await db.batch(statements);
	}
	return { ok: true };
}

/** Records or corrects one of the actor's own punches on `work_date`. */
export async function saveOwnPunch(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, ROLES);
	const parsed = saveSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0].message };
	}
	const employee = await findEmployee(db, actor.employeeId);
	if (null === employee) {
		return NO_EMPLOYEE;
	}
	const { work_date, punch, time } = parsed.data;
	return savePunch(db, actor, { employee, workDate: work_date, punch, time });
}

/** Records or corrects a punch of the employee in `employee_id`, for ADMIN and MANAGER. */
export async function saveEmployeePunch(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, LOGS_EVERYONES_HOURS);
	const parsed = saveSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0].message };
	}
	const choice = employeeChoiceSchema.safeParse(input);
	const employee = choice.success ? await findEmployee(db, choice.data.employee_id) : null;
	if (null === employee) {
		return { ok: false, message: 'Escoge el empleado' };
	}
	const { work_date, punch, time } = parsed.data;
	return savePunch(db, actor, { employee, workDate: work_date, punch, time });
}

export type TeamMember = {
	employeeId: number;
	fullName: string;
	position: string;
	days: TeamDay[];
	regularMinutes: number;
	overtimeMinutes: number;
};

type TeamDay = { workDate: string; punches: Punches };

// What the week's totals read: the derivation's parameters and the holidays.
const overtimeSettingsSchema = z.object({
	PAYROLL_ORDINARY_HOURS_PER_DAY: SETTINGS.PAYROLL_ORDINARY_HOURS_PER_DAY.schema,
	PAYROLL_NIGHT_START: SETTINGS.PAYROLL_NIGHT_START.schema,
	PAYROLL_NIGHT_END: SETTINGS.PAYROLL_NIGHT_END.schema,
	PAYROLL_HOLIDAYS: SETTINGS.PAYROLL_HOLIDAYS.schema
});
type OvertimeSettings = z.infer<typeof overtimeSettingsSchema>;

async function findOvertimeSettings(db: D1Database): Promise<OvertimeSettings> {
	const keys = Object.keys(overtimeSettingsSchema.shape);
	const { results } = await db
		.prepare(`select key, value from settings where key in (${keys.map(() => '?').join(', ')})`)
		.bind(...keys)
		.all<{ key: string; value: string }>();
	return overtimeSettingsSchema.parse(
		Object.fromEntries(results.map(({ key, value }) => [key, value]))
	);
}

// The night surcharge pays ordinary hours, so it isn't one of them.
const OVERTIME_ROWS = [
	'daytimeOvertime',
	'nightOvertime',
	'daytimeHolidayOvertime',
	'nightHolidayOvertime'
] as const;

/** The week's overtime, Sunday and holiday hours included, and the rest of its worked hours. */
function sumWeekHours(days: TeamDay[], settings: OvertimeSettings) {
	let workedMinutes = 0;
	let overtimeMinutes = 0;
	for (const { workDate, punches } of days) {
		const isHoliday = settings.PAYROLL_HOLIDAYS.some((holiday) => workDate === holiday.date);
		const overtime = deriveOvertime({ workDate, ...punches }, isHoliday, settings);
		workedMinutes += countWorkedMinutes(punches);
		overtimeMinutes += OVERTIME_ROWS.reduce((sum, row) => sum + overtime[row], 0);
	}
	return { regularMinutes: workedMinutes - overtimeMinutes, overtimeMinutes };
}

// Position and periods only: the salary never leaves employees.ts.
const teamAttributesSchema = z.object({ position: z.string(), employment: employmentSchema });

function overlapsWeek(employment: Period[], weekDates: string[]): boolean {
	const [first, last] = [weekDates[0], weekDates.at(-1)!];
	return employment.some(
		(period) => period.start <= last && (null === period.end || first <= period.end)
	);
}

async function findTeam(db: D1Database, weekDates: string[]) {
	const { results } = await db
		.prepare('select id, full_name, attributes from employees')
		.all<{ id: number; full_name: string; attributes: string }>();
	return results
		.map((row) => ({ ...row, attributes: teamAttributesSchema.parse(JSON.parse(row.attributes)) }))
		.filter((row) => overlapsWeek(row.attributes.employment, weekDates))
		.sort((first, second) => first.full_name.localeCompare(second.full_name, 'es'));
}

type TeamRow = TimesheetRow & { employeeId: number };

async function findWeekRows(db: D1Database, weekDates: string[]): Promise<TeamRow[]> {
	const { results } = await db
		.prepare(
			`select employee_id as employeeId, work_date as workDate, morning_in as morningIn,
			morning_out as morningOut, afternoon_in as afternoonIn, afternoon_out as afternoonOut
			from timesheets where work_date between ? and ?`
		)
		.bind(weekDates[0], weekDates.at(-1))
		.all<TeamRow>();
	return results;
}

type TeamWeek = { weekDates: string[]; rows: TeamRow[]; settings: OvertimeSettings };

function buildTeamMember(
	member: Awaited<ReturnType<typeof findTeam>>[number],
	{ weekDates, rows, settings }: TeamWeek
): TeamMember {
	const days = weekDates.map((workDate) => {
		const row = rows.find((each) => member.id === each.employeeId && workDate === each.workDate);
		return { workDate, punches: { ...NO_PUNCHES, ...pickPunches(row) } };
	});
	return {
		employeeId: member.id,
		fullName: member.full_name,
		position: member.attributes.position,
		days,
		...sumWeekHours(days, settings)
	};
}

/**
 * Everyone employed at some point of the week (`week` is any of its dates; this week by default),
 * each with the seven days' punches and the week's regular and overtime minutes. Read-only:
 * there's nothing to approve.
 */
export async function getTeamWeek(
	db: D1Database,
	input: { week?: string | null },
	actor: Actor | null
): Promise<{ weekStart: string; team: TeamMember[] }> {
	requireRole(actor, LOGS_EVERYONES_HOURS);
	const today = getTodaysDate();
	const weekStart = getWeekStart(dateSchema.catch(today).parse(input.week ?? today));
	const weekDates = Array.from({ length: DAYS_PER_WEEK }, (_, offset) =>
		addDays(weekStart, offset)
	);
	const [team, rows, settings] = await Promise.all([
		findTeam(db, weekDates),
		findWeekRows(db, weekDates),
		findOvertimeSettings(db)
	]);
	return {
		weekStart,
		team: team.map((member) => buildTeamMember(member, { weekDates, rows, settings }))
	};
}
