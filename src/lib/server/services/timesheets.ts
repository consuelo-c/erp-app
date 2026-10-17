// Hours punches: four a day per employee, typed by hand, never taken from the clock. The punches
// here are the actor's own: the employee is always the actor's, never one sent by the client.

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { addDays, getTodaysDate, getWeekStart } from '$lib/datetime';
import { requireRole, ROLES, type Actor } from '../actor';
import { auditedInsert, auditedUpdate } from '../audit';
import { countWorkedMinutes } from '../overtime';
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
};

export type Result = { ok: true } | { ok: false; message: string };

type Period = z.infer<typeof employmentSchema>[number];
type OwnEmployee = { id: number; fullName: string; employment: Period[] };
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
// The hour comes as people say it: 1 to 12, the minutes, and a.m. or p.m. Stored as `HH:MM`.
const HOUR_MESSAGE = 'Escribe la hora, de 1 a 12';
const MINUTE_MESSAGE = 'Escribe los minutos, de 0 a 59';
const saveSchema = z
	.object({
		work_date: z.iso.date('Escoge el día'),
		punch: z.enum(punchKeys),
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
	})
	.transform(({ hour, minute, period, ...rest }) => ({
		...rest,
		time: toClockTime(hour, minute, period)
	}));

// 12 a.m. is midnight (00) and 12 p.m. is noon (12).
function toClockTime(hour: number, minute: number, period: 'am' | 'pm'): string {
	const hour24 = (hour % 12) + ('pm' === period ? 12 : 0);
	return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
const dateSchema = z.iso.date();

const NO_EMPLOYEE: Result = { ok: false, message: 'Tu usuario no está vinculado a un empleado' };
const OUT_OF_ORDER: Result = {
	ok: false,
	message: 'Las marcas deben ir en orden: inicio y finalización de la mañana, luego de la tarde'
};

async function findOwnEmployee(db: D1Database, actor: Actor): Promise<OwnEmployee | null> {
	if (null === actor.employeeId) {
		return null;
	}
	const row = await db
		.prepare('select id, full_name, attributes from employees where id = ?')
		.bind(actor.employeeId)
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
	employeeId: number,
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
			return { workDate, punches, workedMinutes, isPaid, isFuture: workDate > today };
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

/**
 * The actor's own day and the week shown under it (the day's week unless `week` names another).
 * Null when the login has no employee: it can't punch. A future or malformed day is a 404.
 */
export async function getOwnHours(
	db: D1Database,
	input: { date: string; week?: string | null },
	actor: Actor | null
): Promise<{ employeeName: string; day: TimesheetDay; week: TimesheetDay[] } | null> {
	requireRole(actor, ROLES);
	const employee = await findOwnEmployee(db, actor);
	if (null === employee) {
		return null;
	}
	const date = dateSchema.safeParse(input.date);
	if (!date.success || date.data > getTodaysDate()) {
		error(404, 'Ese día no existe');
	}
	const weekStart = getWeekStart(dateSchema.catch(date.data).parse(input.week ?? date.data));
	const weekDates = Array.from({ length: DAYS_PER_WEEK }, (_, offset) =>
		addDays(weekStart, offset)
	);
	const [[day], week] = await Promise.all([
		buildDays(db, employee.id, [date.data]),
		buildDays(db, employee.id, weekDates)
	]);
	return { employeeName: employee.fullName, day, week };
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
	employee: OwnEmployee,
	workDate: string
): Promise<string | null> {
	if (workDate > getTodaysDate()) {
		return 'Ese día todavía no ha llegado';
	}
	if (!isWithinEmployment(employee.employment, workDate)) {
		return 'Ese día no estabas trabajando en la empresa';
	}
	if (await isDayPaid(db, { employeeId: employee.id, workDate })) {
		return 'Ese día ya se pagó en la nómina: no se puede cambiar';
	}
	return null;
}

type PunchChange = { employee: OwnEmployee; workDate: string; punch: Punch; time: string };

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
	const employee = await findOwnEmployee(db, actor);
	if (null === employee) {
		return NO_EMPLOYEE;
	}
	const { work_date, punch, time } = parsed.data;
	return savePunch(db, actor, { employee, workDate: work_date, punch, time });
}
