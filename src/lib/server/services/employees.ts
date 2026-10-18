// The people on payroll. A row per person: leaving closes the last employment period and rehiring
// appends a new one, so `id_number` stays UNIQUE and the history stays on the same row.

import { z } from 'zod';
import { requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate } from '../audit';

// Salaries live here, so only the ones who settle payroll see or touch employees.
const MANAGES_EMPLOYEES = ['ADMIN', 'MANAGER'] as const;

const periodSchema = z
	.object({ start: z.iso.date(), end: z.iso.date().nullable() })
	.refine((period) => null === period.end || period.end >= period.start, {
		message: 'Un período no puede terminar antes de empezar'
	});

/** Sorted, non-overlapping periods; only the last may be open (`end: null`). */
export const employmentSchema = z
	.array(periodSchema)
	.nonempty()
	.refine(
		(periods) =>
			periods.every((period, i) => {
				const next = periods[i + 1];
				return undefined === next || (null !== period.end && period.end < next.start);
			}),
		{
			message: 'Los períodos deben ir en orden, sin cruzarse, y solo el último puede seguir abierto'
		}
	);

// SQLite validates nothing: the JSON is checked on write and on read, salary included.
const attributesSchema = z.object({
	monthly_salary: z.number().int().nonnegative(),
	position: z.string(),
	bank_account: z.string().min(1).optional(),
	employment: employmentSchema
});

type Attributes = z.infer<typeof attributesSchema>;
type Period = z.infer<typeof periodSchema>;

export type Employee = {
	id: number;
	fullName: string;
	idNumber: string;
	monthlySalary: number;
	position: string;
	bankAccount: string | null;
	employment: Period[];
	isEmployed: boolean;
};

export type Result = { ok: true; id: number } | { ok: false; message: string };

type EmployeeRow = { id: number; full_name: string; id_number: string; attributes: string };

// Punctuation is how people type them (71.384.902); only the digits are stored and compared.
const digitsSchema = (message: string) =>
	z
		.string()
		.transform((value) => value.replace(/\D/g, ''))
		.pipe(z.string().min(1, message));

const detailsSchema = z.object({
	full_name: z.string().trim().min(1, 'Escribe el nombre completo'),
	id_number: digitsSchema('Escribe la cédula'),
	monthly_salary: digitsSchema('Escribe el salario mensual').transform(Number),
	position: z.string().trim().min(1, 'Escribe el cargo'),
	// Optional: left blank, the key isn't stored.
	bank_account: z
		.string()
		.trim()
		.optional()
		.transform((value) => value || undefined)
});

const idSchema = z.coerce.number().int().positive();

const createSchema = detailsSchema.extend({ start: z.iso.date('Escoge la fecha de ingreso') });
const updateSchema = detailsSchema.extend({ id: idSchema });
const endSchema = z.object({ id: idSchema, end: z.iso.date('Escoge la fecha de retiro') });
const rehireSchema = z.object({ id: idSchema, start: z.iso.date('Escoge la fecha de ingreso') });

function invalid(error: z.ZodError): Result {
	return { ok: false, message: error.issues[0].message };
}

// Always the same key order, so an edit that changes nothing produces the same text and logs nothing.
function attributesJson(attributes: Attributes): string {
	const { monthly_salary, position, bank_account, employment } = attributesSchema.parse(attributes);
	return JSON.stringify({ monthly_salary, position, bank_account, employment });
}

function toEmployee(row: EmployeeRow): Employee {
	const attributes = attributesSchema.parse(JSON.parse(row.attributes));
	return {
		id: row.id,
		fullName: row.full_name,
		idNumber: row.id_number,
		monthlySalary: attributes.monthly_salary,
		position: attributes.position,
		bankAccount: attributes.bank_account ?? null,
		employment: attributes.employment,
		isEmployed: null === attributes.employment.at(-1)?.end
	};
}

async function findRow(db: D1Database, id: number): Promise<EmployeeRow | null> {
	return db
		.prepare('select id, full_name, id_number, attributes from employees where id = ?')
		.bind(id)
		.first<EmployeeRow>();
}

// The UNIQUE column still guards a race; this turns the common case into a message, not a 500.
async function idNumberTaken(db: D1Database, idNumber: string, exceptId: number): Promise<boolean> {
	const row = await db
		.prepare('select 1 from employees where id_number = ? and id != ?')
		.bind(idNumber, exceptId)
		.first();
	return null !== row;
}

const ID_NUMBER_TAKEN: Result = { ok: false, message: 'Ya existe un empleado con esa cédula' };

/** Every employee, the currently employed first; a few dozen rows, filtered in JS. */
export async function listEmployees(db: D1Database, actor: Actor | null): Promise<Employee[]> {
	requireRole(actor, MANAGES_EMPLOYEES);
	const { results } = await db
		.prepare('select id, full_name, id_number, attributes from employees')
		.all<EmployeeRow>();
	return results
		.map(toEmployee)
		.sort(
			(first, second) =>
				Number(second.isEmployed) - Number(first.isEmployed) ||
				first.fullName.localeCompare(second.fullName, 'es')
		);
}

export async function getEmployee(
	db: D1Database,
	id: number,
	actor: Actor | null
): Promise<Employee | null> {
	requireRole(actor, MANAGES_EMPLOYEES);
	const row = await findRow(db, id);
	return null === row ? null : toEmployee(row);
}

/** Creates the employee with their first employment period open. */
export async function createEmployee(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_EMPLOYEES);
	const parsed = createSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const { full_name, id_number, monthly_salary, position, bank_account, start } = parsed.data;
	if (await idNumberTaken(db, id_number, 0)) {
		return ID_NUMBER_TAKEN;
	}
	const attributes = attributesJson({
		monthly_salary,
		position,
		bank_account,
		employment: [{ start, end: null }]
	});
	const [insert, event] = auditedInsert(db, {
		table: 'employees',
		entityType: 'EMPLOYEE',
		actor,
		values: { full_name, id_number, attributes }
	});
	const [inserted] = await db.batch<{ id: number }>([insert, event]);
	return { ok: true, id: inserted.meta.last_row_id };
}

type Edit = {
	row: EmployeeRow;
	changes: { full_name?: string; id_number?: string; attributes: Attributes };
};

async function applyEdit(db: D1Database, actor: Actor, { row, changes }: Edit): Promise<Result> {
	const statements = auditedUpdate(db, {
		table: 'employees',
		entityType: 'EMPLOYEE',
		actor,
		id: row.id,
		current: { full_name: row.full_name, id_number: row.id_number, attributes: row.attributes },
		changes: { ...changes, attributes: attributesJson(changes.attributes) }
	});
	if (0 < statements.length) {
		await db.batch(statements);
	}
	return { ok: true, id: row.id };
}

const NOT_FOUND: Result = { ok: false, message: 'Ese empleado no existe' };

/** Name, ID number, salary, position and bank account; the employment periods change only by ending or rehiring. */
export async function updateEmployee(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_EMPLOYEES);
	const parsed = updateSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const { id, full_name, id_number, monthly_salary, position, bank_account } = parsed.data;
	const row = await findRow(db, id);
	if (null === row) {
		return NOT_FOUND;
	}
	if (await idNumberTaken(db, id_number, id)) {
		return ID_NUMBER_TAKEN;
	}
	const { employment } = toEmployee(row);
	return applyEdit(db, actor, {
		row,
		changes: {
			full_name,
			id_number,
			attributes: { monthly_salary, position, bank_account, employment }
		}
	});
}

// Ending and rehiring only change the periods: `change` returns the new ones, or why it can't.
async function changeEmployment(
	db: D1Database,
	actor: Actor,
	{ id, change }: { id: number; change: (employee: Employee) => Period[] | string }
): Promise<Result> {
	const row = await findRow(db, id);
	if (null === row) {
		return NOT_FOUND;
	}
	const employee = toEmployee(row);
	const employment = change(employee);
	if ('string' === typeof employment) {
		return { ok: false, message: employment };
	}
	const attributes = { ...attributesSchema.parse(JSON.parse(row.attributes)), employment };
	return applyEdit(db, actor, { row, changes: { attributes } });
}

/** Ends the open period on `end`. The row stays: employees own hours and settlements. */
export async function endEmployment(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_EMPLOYEES);
	const parsed = endSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const { id, end } = parsed.data;
	return changeEmployment(db, actor, {
		id,
		change: ({ isEmployed, employment }) => {
			const current = employment.at(-1)!;
			if (!isEmployed) {
				return 'Este empleado ya está retirado';
			}
			if (end < current.start) {
				return 'La fecha de retiro no puede ser anterior al ingreso';
			}
			return [...employment.slice(0, -1), { ...current, end }];
		}
	});
}

/** Appends a new open period to the same row: a rehire is never a second employee. */
export async function rehire(db: D1Database, input: unknown, actor: Actor | null): Promise<Result> {
	requireRole(actor, MANAGES_EMPLOYEES);
	const parsed = rehireSchema.safeParse(input);
	if (!parsed.success) {
		return invalid(parsed.error);
	}
	const { id, start } = parsed.data;
	return changeEmployment(db, actor, {
		id,
		change: ({ isEmployed, employment }) => {
			if (isEmployed) {
				return 'Este empleado ya está trabajando';
			}
			if (start <= employment.at(-1)!.end!) {
				return 'La fecha de ingreso debe ser posterior al último retiro';
			}
			return [...employment, { start, end: null }];
		}
	});
}
