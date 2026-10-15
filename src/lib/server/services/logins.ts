// Logins: who can log in as whom. `ADMIN` only: the risk isn't just who changed what, it's
// impersonation. A login isn't a person, so its employee is optional.

import { z } from 'zod';
import { requireRole, ROLES, rolesSchema, type Actor, type Role } from '../actor';
import { auditedInsert, auditedUpdate, type Row } from '../audit';
import { hashPassword } from '../password';
import { listEmployees, type Result } from './employees';

const MANAGES_LOGINS = ['ADMIN'] as const;

/** Hashing a password needs the pepper, which lives only in the Worker's secrets. */
type Environment = { db: D1Database; pepper: string };

const NOT_FOUND = 'Ese login no existe';

export type Login = {
	id: number;
	username: string;
	roles: Role[];
	employee: { id: number; fullName: string } | null;
	isActive: boolean;
};

type LoginRow = {
	id: number;
	username: string;
	roles: string;
	active: number;
	employee_id: number | null;
	full_name: string | null;
};

// A select posts '' for "no employee".
const employeeIdSchema = z.preprocess(
	(value) => ('' === value ? null : value),
	z.coerce.number().int().positive().nullable()
);

const idSchema = z.coerce.number().int().positive();

const passwordSchema = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres');

// Checkboxes post the chosen roles; kept in ROLES order, so re-saving the same set logs nothing.
const formRolesSchema = z
	.array(z.string())
	.min(1, 'Escoge al menos un rol')
	.pipe(rolesSchema)
	.transform((roles) => ROLES.filter((role) => roles.includes(role)));

const createSchema = z.object({
	username: z
		.string()
		.trim()
		.toLowerCase()
		.min(1, 'Escribe el usuario')
		// The audit sentinel for writes no login made.
		.refine((username) => 'system' !== username, 'Ese usuario está reservado'),
	roles: formRolesSchema,
	employee_id: employeeIdSchema,
	password: passwordSchema
});

const rolesUpdateSchema = z.object({ id: idSchema, roles: formRolesSchema });
const passwordUpdateSchema = z.object({ id: idSchema, password: passwordSchema });
const reassignSchema = z.object({
	id: idSchema,
	employee_id: employeeIdSchema,
	password: passwordSchema
});
const loginIdSchema = z.object({ id: idSchema });

const SELECT_LOGIN =
	'select users.id, users.username, users.roles, users.active, users.employee_id, employees.full_name from users left join employees on employees.id = users.employee_id';

// The foreign key guarantees `full_name` whenever `employee_id` is set.
function toLogin(row: LoginRow): Login {
	return {
		id: row.id,
		username: row.username,
		roles: rolesSchema.parse(JSON.parse(row.roles)),
		employee:
			null === row.employee_id ? null : { id: row.employee_id, fullName: row.full_name ?? '' },
		isActive: 1 === row.active
	};
}

/** Every login, the active ones first, by username. Never the hash or the salt. */
export async function listLogins(db: D1Database, actor: Actor | null): Promise<Login[]> {
	requireRole(actor, MANAGES_LOGINS);
	const { results } = await db
		.prepare(`${SELECT_LOGIN} order by users.active desc, users.username`)
		.all<LoginRow>();
	return results.map(toLogin);
}

/** The currently employed without a login: the only ones a login can be given to. */
export async function listEmployeesWithoutLogin(
	db: D1Database,
	actor: Actor | null
): Promise<{ id: number; fullName: string }[]> {
	requireRole(actor, MANAGES_LOGINS);
	const [employees, { results }] = await Promise.all([
		listEmployees(db, actor),
		db
			.prepare('select employee_id from users where employee_id is not null')
			.all<{ employee_id: number }>()
	]);
	const withLogin = new Set(results.map((row) => row.employee_id));
	return employees
		.filter((employee) => employee.isEmployed && !withLogin.has(employee.id))
		.map(({ id, fullName }) => ({ id, fullName }));
}

// The UNIQUE columns still guard a race; these turn the common case into a message, not a 500.
async function findConflict(
	db: D1Database,
	{ username, employeeId }: { username: string; employeeId: number | null },
	actor: Actor
): Promise<string | null> {
	if (
		null !== (await db.prepare('select 1 from users where username = ?').bind(username).first())
	) {
		return 'Ya existe un login con ese usuario';
	}
	return findEmployeeProblem(db, employeeId, actor);
}

async function findEmployeeProblem(
	db: D1Database,
	employeeId: number | null,
	actor: Actor
): Promise<string | null> {
	const assignable = await listEmployeesWithoutLogin(db, actor);
	if (null !== employeeId && !assignable.some((employee) => employee.id === employeeId)) {
		return 'Ese empleado ya tiene login o no está trabajando';
	}
	return null;
}

// Only the hash is secret, but the three columns travel together and stay out of `events`.
async function passwordColumns(password: string, pepper: string): Promise<Row> {
	const stored = await hashPassword(password, pepper);
	return {
		password_hash: stored.hash,
		password_salt: stored.salt,
		password_iterations: stored.iterations
	};
}

/** Creates a login with one or more roles and, optionally, the employee it belongs to. */
export async function createLogin(
	{ db, pepper }: Environment,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_LOGINS);
	const parsed = createSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0].message };
	}
	const { username, roles, employee_id, password } = parsed.data;
	const conflict = await findConflict(db, { username, employeeId: employee_id }, actor);
	if (null !== conflict) {
		return { ok: false, message: conflict };
	}
	const [insert, event] = auditedInsert(db, {
		table: 'users',
		entityType: 'USER',
		actor,
		values: { username, roles: JSON.stringify(roles), employee_id },
		unlogged: await passwordColumns(password, pepper)
	});
	const [inserted] = await db.batch<{ id: number }>([insert, event]);
	return { ok: true, id: inserted.meta.last_row_id };
}

export async function getLogin(
	db: D1Database,
	id: number,
	actor: Actor | null
): Promise<Login | null> {
	requireRole(actor, MANAGES_LOGINS);
	const row = await db.prepare(`${SELECT_LOGIN} where users.id = ?`).bind(id).first<LoginRow>();
	return null === row ? null : toLogin(row);
}

// Logins are only managed by ADMIN: dropping it from your own login could leave nobody able to.
function findRolesProblem(login: Login | null, roles: Role[], actor: Actor): string | null {
	if (null === login) {
		return NOT_FOUND;
	}
	if (login.username === actor.username && !roles.includes('ADMIN')) {
		return 'No puedes quitarte el rol de Administrador';
	}
	return null;
}

/** Replaces the login's roles; they take effect on its next request, sessions included. */
export async function updateRoles(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_LOGINS);
	const parsed = rolesUpdateSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0].message };
	}
	const { id, roles } = parsed.data;
	const login = await getLogin(db, id, actor);
	const problem = findRolesProblem(login, roles, actor);
	if (null !== problem) {
		return { ok: false, message: problem };
	}
	const statements = auditedUpdate(db, {
		table: 'users',
		entityType: 'USER',
		actor,
		id,
		current: { roles: JSON.stringify(login!.roles) },
		changes: { roles: JSON.stringify(roles) }
	});
	if (0 < statements.length) {
		await db.batch(statements);
	}
	return { ok: true, id };
}

type SessionEndingWrite = {
	login: Login;
	current: Row;
	changes: Row;
	unlogged?: Row;
	action?: string;
};

// Who can log in as this login changed: every session it has ends, so the previous person's phone
// is logged out. Sessions aren't audited rows: deleting them is the one exception to "never delete".
async function applySessionEndingWrite(
	db: D1Database,
	actor: Actor,
	{ login, ...write }: SessionEndingWrite
): Promise<Result> {
	const update = auditedUpdate(db, {
		table: 'users',
		entityType: 'USER',
		actor,
		id: login.id,
		...write
	});
	const endSessions = db.prepare('delete from sessions where user_id = ?').bind(login.id);
	await db.batch([...update, endSessions]);
	return { ok: true, id: login.id };
}

/** Sets a new password directly: no token, no email. The hash never reaches `events`. */
export async function setPassword(
	{ db, pepper }: Environment,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_LOGINS);
	const parsed = passwordUpdateSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0].message };
	}
	const login = await getLogin(db, parsed.data.id, actor);
	if (null === login) {
		return { ok: false, message: NOT_FOUND };
	}
	return applySessionEndingWrite(db, actor, {
		login,
		action: 'PASSWORD_SET',
		current: {},
		changes: {},
		unlogged: await passwordColumns(parsed.data.password, pepper)
	});
}

async function findReassignProblem(
	db: D1Database,
	{ login, employeeId }: { login: Login | null; employeeId: number | null },
	actor: Actor
): Promise<string | null> {
	if (null === login) {
		return NOT_FOUND;
	}
	if ((login.employee?.id ?? null) === employeeId) {
		return 'Escoge un empleado distinto al actual';
	}
	return findEmployeeProblem(db, employeeId, actor);
}

/**
 * Points the login at another employee (or none) with a new password. The previous employee's
 * rows stay as they are; the event holds the old and new `employee_id`.
 */
export async function reassignLogin(
	{ db, pepper }: Environment,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_LOGINS);
	const parsed = reassignSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0].message };
	}
	const { id, employee_id, password } = parsed.data;
	const login = await getLogin(db, id, actor);
	const problem = await findReassignProblem(db, { login, employeeId: employee_id }, actor);
	if (null !== problem) {
		return { ok: false, message: problem };
	}
	return applySessionEndingWrite(db, actor, {
		login: login!,
		current: { employee_id: login!.employee?.id ?? null },
		changes: { employee_id },
		unlogged: await passwordColumns(password, pepper)
	});
}

// Deactivating your own login would end your session and could leave nobody to manage logins.
function findDeactivateProblem(login: Login | null, actor: Actor): string | null {
	if (null === login) {
		return NOT_FOUND;
	}
	if (login.username === actor.username) {
		return 'No puedes desactivar tu propio login';
	}
	if (!login.isActive) {
		return 'Este login ya está inactivo';
	}
	return null;
}

/** Blocks the login: `active = 0`, never deleted, since logins sign orders and records. */
export async function deactivateLogin(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_LOGINS);
	const parsed = loginIdSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0].message };
	}
	const login = await getLogin(db, parsed.data.id, actor);
	const problem = findDeactivateProblem(login, actor);
	if (null !== problem) {
		return { ok: false, message: problem };
	}
	return applySessionEndingWrite(db, actor, {
		login: login!,
		current: { active: 1 },
		changes: { active: 0 }
	});
}

/** Lets a deactivated login in again, with the password it had. */
export async function reactivateLogin(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<Result> {
	requireRole(actor, MANAGES_LOGINS);
	const parsed = loginIdSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0].message };
	}
	const login = await getLogin(db, parsed.data.id, actor);
	if (null === login) {
		return { ok: false, message: NOT_FOUND };
	}
	if (login.isActive) {
		return { ok: false, message: 'Este login ya está activo' };
	}
	const write = { table: 'users', entityType: 'USER', actor, id: login.id };
	await db.batch(auditedUpdate(db, { ...write, current: { active: 0 }, changes: { active: 1 } }));
	return { ok: true, id: login.id };
}
