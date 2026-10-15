// Logins: who can log in as whom. `ADMIN` only: the risk isn't just who changed what, it's
// impersonation. A login isn't a person, so its employee is optional.

import { z } from 'zod';
import { requireRole, ROLES, rolesSchema, type Actor, type Role } from '../actor';
import { auditedInsert, auditedUpdate } from '../audit';
import { hashPassword } from '../password';
import { listEmployees, type Result } from './employees';

const MANAGES_LOGINS = ['ADMIN'] as const;

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
	password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres')
});

// The foreign key guarantees `full_name` whenever `employee_id` is set.
const rolesUpdateSchema = z.object({
	id: z.coerce.number().int().positive(),
	roles: formRolesSchema
});

const SELECT_LOGIN =
	'select users.id, users.username, users.roles, users.active, users.employee_id, employees.full_name from users left join employees on employees.id = users.employee_id';

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
	const assignable = await listEmployeesWithoutLogin(db, actor);
	if (null !== employeeId && !assignable.some((employee) => employee.id === employeeId)) {
		return 'Ese empleado ya tiene login o no está trabajando';
	}
	return null;
}

/** Creates a login with one or more roles and, optionally, the employee it belongs to. */
export async function createLogin(
	{ db, pepper }: { db: D1Database; pepper: string },
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
	const stored = await hashPassword(password, pepper);
	const [insert, event] = auditedInsert(db, {
		table: 'users',
		entityType: 'USER',
		actor,
		values: { username, roles: JSON.stringify(roles), employee_id },
		unlogged: {
			password_hash: stored.hash,
			password_salt: stored.salt,
			password_iterations: stored.iterations
		}
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
		return 'Ese login no existe';
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
