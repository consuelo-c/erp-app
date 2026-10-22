// The people on payroll. A row per person: leaving closes the last employment period and rehiring
// appends a new one, so the history stays on the same row. Each is a contact: name, phone and ID
// number live there, so they read the same in Contactos.

import { z } from 'zod';
import { requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate } from '../audit';
import { documentIdSchema, invalidForm, phoneSchema, takenRefusal } from './contacts';

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
// `salary_bank_account` is where payroll goes, not the contact's `bank_account`, which Sales may fill in.
const attributesSchema = z.object({
	monthly_salary: z.number().int().nonnegative(),
	position: z.string(),
	salary_bank_account: z.string().min(1).optional(),
	employment: employmentSchema
});

type Attributes = z.infer<typeof attributesSchema>;
type Period = z.infer<typeof periodSchema>;

export type Employee = {
	id: number;
	phone: string;
	fullName: string;
	idNumber: string;
	monthlySalary: number;
	position: string;
	salaryBankAccount: string | null;
	employment: Period[];
	isEmployed: boolean;
};

export type Result =
	{ ok: true; id: number } | { ok: false; message: string; errors?: Record<string, string> };

type EmployeeRow = {
	id: number;
	contact_id: number;
	phone: string;
	full_name: string;
	document_id: string;
	attributes: string;
};

// Every read of an employee's name goes through its contact.
const EMPLOYEE_SELECT = `select employees.id, employees.contact_id, contacts.phone, contacts.full_name,
	contacts.document_id, employees.attributes
	from employees join contacts on contacts.id = employees.contact_id`;

const detailsSchema = z.object({
	phone: phoneSchema,
	full_name: z.string().trim().min(1, 'Escribe el nombre completo'),
	// Optional on a contact, required on an employee: payroll prints it.
	document_id: documentIdSchema.pipe(z.string('Escribe la cédula')),
	// Punctuation is how people type it ($1.423.500): only the digits count.
	monthly_salary: z
		.string()
		.transform((value) => value.replace(/\D/g, ''))
		.pipe(z.string().min(1, 'Escribe el salario mensual'))
		.transform(Number),
	position: z.string().trim().min(1, 'Escribe el cargo'),
	// Optional: left blank, the key isn't stored.
	salary_bank_account: z
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
	const { monthly_salary, position, salary_bank_account, employment } =
		attributesSchema.parse(attributes);
	return JSON.stringify({ monthly_salary, position, salary_bank_account, employment });
}

function toEmployee(row: EmployeeRow): Employee {
	const attributes = attributesSchema.parse(JSON.parse(row.attributes));
	return {
		id: row.id,
		phone: row.phone,
		fullName: row.full_name,
		idNumber: row.document_id,
		monthlySalary: attributes.monthly_salary,
		position: attributes.position,
		salaryBankAccount: attributes.salary_bank_account ?? null,
		employment: attributes.employment,
		isEmployed: null === attributes.employment.at(-1)?.end
	};
}

async function findRow(db: D1Database, id: number): Promise<EmployeeRow | null> {
	return db.prepare(`${EMPLOYEE_SELECT} where employees.id = ?`).bind(id).first<EmployeeRow>();
}

/** Every employee, the currently employed first; a few dozen rows, filtered in JS. */
export async function listEmployees(db: D1Database, actor: Actor | null): Promise<Employee[]> {
	requireRole(actor, MANAGES_EMPLOYEES);
	const { results } = await db.prepare(EMPLOYEE_SELECT).all<EmployeeRow>();
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

type PhoneOwnerRow = {
	id: number;
	full_name: string;
	document_id: string | null;
	employee_id: number | null;
};

async function findPhoneOwner(db: D1Database, phone: string): Promise<PhoneOwnerRow | null> {
	return db
		.prepare(
			`select contacts.id, contacts.full_name, contacts.document_id, employees.id as employee_id
			from contacts left join employees on employees.contact_id = contacts.id
			where contacts.phone = ?`
		)
		.bind(phone)
		.first<PhoneOwnerRow>();
}

// A contact is at most one employee: `contact_id` is UNIQUE.
function employedMessage(fullName: string): string {
	return `Ese teléfono ya es de ${fullName}, que ya está en Personal`;
}

function alreadyEmployed(fullName: string): Result {
	return {
		ok: false,
		message: 'Revisa los campos marcados en rojo antes de guardar.',
		errors: { phone: employedMessage(fullName) }
	};
}

export type PhoneMatch = { fullName: string; documentId: string | null; error: string | null };

/**
 * The contact a new employee's typed phone would reuse, for the form to fill in its name and ID
 * number, or why it can't; null when the phone is new or not valid yet.
 */
export async function matchPhone(
	db: D1Database,
	typed: unknown,
	actor: Actor | null
): Promise<PhoneMatch | null> {
	requireRole(actor, MANAGES_EMPLOYEES);
	const phone = phoneSchema.safeParse(typed);
	const owner = phone.success ? await findPhoneOwner(db, phone.data) : null;
	if (null === owner) {
		return null;
	}
	return {
		fullName: owner.full_name,
		documentId: owner.document_id,
		error: null === owner.employee_id ? null : employedMessage(owner.full_name)
	};
}

/**
 * Creates the employee with their first employment period open, on the contact that has the phone:
 * the existing one, its name and ID number updated, or a new one, all in one batch.
 */
export async function createEmployee(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_EMPLOYEES);
	const parsed = createSchema.safeParse(input);
	if (!parsed.success) {
		return invalidForm(parsed.error);
	}
	const { phone, full_name, document_id, start, ...details } = parsed.data;
	const owner = await findPhoneOwner(db, phone);
	if (null !== owner && null !== owner.employee_id) {
		return alreadyEmployed(owner.full_name);
	}
	const refusal = await takenRefusal(db, { phone, document_id }, owner?.id ?? 0);
	if (null !== refusal) {
		return refusal;
	}
	const attributes = attributesJson({ ...details, employment: [{ start, end: null }] });
	const results = await db.batch([
		...contactWrite(db, actor, { owner, contact: { phone, full_name, document_id } }),
		...employeeInsert(db, actor, { phone, attributes })
	]);
	return { ok: true, id: results.at(-2)!.meta.last_row_id };
}

type ContactColumns = { phone: string; full_name: string; document_id: string };

const CONTACT = { table: 'contacts', entityType: 'CONTACT' };

// A new phone inserts its contact; a known one gets the name and ID number typed.
function contactWrite(
	db: D1Database,
	actor: Actor,
	{ owner, contact }: { owner: PhoneOwnerRow | null; contact: ContactColumns }
) {
	if (null === owner) {
		return auditedInsert(db, { ...CONTACT, actor, values: contact });
	}
	const { full_name, document_id } = contact;
	const changes = { full_name, document_id };
	return auditedUpdate(db, { ...CONTACT, actor, id: owner.id, current: owner, changes });
}

// The contact's id from its UNIQUE phone, not last_insert_rowid(): by now that's its event's.
function employeeInsert(
	db: D1Database,
	actor: Actor,
	{ phone, attributes }: { phone: string; attributes: string }
) {
	return auditedInsert(db, {
		table: 'employees',
		entityType: 'EMPLOYEE',
		actor,
		values: { attributes },
		computed: { contact_id: { sql: 'select id from contacts where phone = ?', params: [phone] } }
	});
}

function attributesUpdate(
	db: D1Database,
	actor: Actor,
	{ row, attributes }: { row: EmployeeRow; attributes: Attributes }
) {
	return auditedUpdate(db, {
		table: 'employees',
		entityType: 'EMPLOYEE',
		actor,
		id: row.id,
		current: { attributes: row.attributes },
		changes: { attributes: attributesJson(attributes) }
	});
}

// An edit that changes nothing writes nothing.
async function run(db: D1Database, statements: D1PreparedStatement[], id: number): Promise<Result> {
	if (0 < statements.length) {
		await db.batch(statements);
	}
	return { ok: true, id };
}

const NOT_FOUND: Result = { ok: false, message: 'Ese empleado no existe' };

/**
 * Phone, name and ID number, saved on the employee's own contact (never relinked to another), and
 * salary, position and payroll account; the employment periods change only by ending or rehiring.
 */
export async function updateEmployee(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_EMPLOYEES);
	const parsed = updateSchema.safeParse(input);
	if (!parsed.success) {
		return invalidForm(parsed.error);
	}
	const { id, phone, full_name, document_id, ...details } = parsed.data;
	const row = await findRow(db, id);
	if (null === row) {
		return NOT_FOUND;
	}
	const refusal = await takenRefusal(db, { phone, document_id }, row.contact_id);
	if (null !== refusal) {
		return refusal;
	}
	const { employment } = toEmployee(row);
	const contact = auditedUpdate(db, {
		...CONTACT,
		actor,
		id: row.contact_id,
		current: row,
		changes: { phone, full_name, document_id }
	});
	const attributes = { ...details, employment };
	return run(db, [...contact, ...attributesUpdate(db, actor, { row, attributes })], id);
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
	return run(db, attributesUpdate(db, actor, { row, attributes }), id);
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
