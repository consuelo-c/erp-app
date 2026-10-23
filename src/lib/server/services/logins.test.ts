import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { logIn } from './auth';
import { createEmployee, endEmployment } from './employees';
import {
	createLogin,
	deactivateLogin,
	reactivateLogin,
	getLogin,
	listEmployeesWithoutLogin,
	listLogins,
	reassignLogin,
	setPassword,
	updateRoles
} from './logins';

const admin: Actor = { username: 'admin', employeeId: null, roles: ['ADMIN'], kind: 'user' };
const manager: Actor = { ...admin, username: 'gerente', roles: ['MANAGER'] };
const pepper = 'test-pepper';

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
});

async function hire(fullName: string, idNumber: string): Promise<number> {
	const phone = `310${idNumber.slice(-7)}`;
	const input = { phone, full_name: fullName, document_id: idNumber, monthly_salary: '1423500' };
	const result = await createEmployee(
		db,
		{ ...input, position: 'Bodega', start: '2024-07-15' },
		admin
	);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.id;
}

const bodega = { username: ' Bodega ', roles: ['WAREHOUSE', 'DRIVER'], password: 'clave-bodega' };

function create(input: Record<string, unknown>, actor: Actor = admin) {
	return createLogin({ db, pepper }, { employee_id: '', ...input }, actor);
}

function logInAs(username: string, password: string) {
	// With no `admin` login yet, the first attempt creates it from the secret.
	const secrets = { pepper, adminPassword: 'clave-admin' };
	const context = { secrets, request: { ip: null, userAgent: null } };
	return logIn(db, { username, password }, context);
}

function sessionCount(): unknown {
	return database.prepare('select count(*) as count from sessions').get()?.count;
}

// The last write's event: LOGIN, LOGIN_FAILED and LOGOUT rows are access, not writes.
function lastEvent() {
	return database
		.prepare(
			"select action, before, after from events where action not like 'LOG%' order by id desc"
		)
		.get();
}

test('creates a login with several roles and an employee; it can log in', async () => {
	const carlos = await hire('Carlos Vélez', '71384902');
	const result = await create({ ...bodega, employee_id: String(carlos) });
	expect(result.ok).toBe(true);

	expect(await listLogins(db, admin)).toEqual([
		{
			id: 1,
			username: 'bodega',
			roles: ['WAREHOUSE', 'DRIVER'],
			employee: { id: carlos, fullName: 'Carlos Vélez' },
			isActive: true
		}
	]);
	expect(await logInAs('bodega', 'clave-bodega')).not.toBeNull();
});

test('the CREATED event carries neither the hash nor the salt', async () => {
	await create(bodega);
	const event = database
		.prepare("select after from events where entity_type = 'USER' and action = 'CREATED'")
		.get();
	expect(JSON.parse(String(event?.after))).toEqual({
		username: 'bodega',
		roles: '["WAREHOUSE","DRIVER"]',
		employee_id: null
	});
});

test('rejects the reserved username, a taken one, no roles and a short password', async () => {
	await create(bodega);
	expect(await create({ ...bodega, username: 'SYSTEM' })).toEqual({
		ok: false,
		message: 'Ese usuario está reservado'
	});
	expect(await create({ ...bodega, username: 'BODEGA' })).toEqual({
		ok: false,
		message: 'Ya existe un login con ese usuario'
	});
	expect(await create({ ...bodega, username: 'ventas', roles: [] })).toEqual({
		ok: false,
		message: 'Escoge al menos un rol'
	});
	expect(await create({ ...bodega, username: 'ventas', password: 'corta' })).toEqual({
		ok: false,
		message: 'La contraseña debe tener al menos 8 caracteres'
	});
});

test('changing roles logs the old and new set, in ROLES order', async () => {
	await create(bodega);
	expect((await updateRoles(db, { id: '1', roles: ['DRIVER', 'SALES'] }, admin)).ok).toBe(true);
	expect((await getLogin(db, 1, admin))?.roles).toEqual(['SALES', 'DRIVER']);
	const edited = database.prepare("select before, after from events where action = 'EDITED'").get();
	expect(JSON.parse(String(edited?.before))).toEqual({ roles: '["WAREHOUSE","DRIVER"]' });
	expect(JSON.parse(String(edited?.after))).toEqual({ roles: '["SALES","DRIVER"]' });
});

test('an admin cannot drop ADMIN from their own login', async () => {
	await create({ ...bodega, username: 'admin', roles: ['ADMIN'] });
	expect(await updateRoles(db, { id: 1, roles: ['MANAGER'] }, admin)).toEqual({
		ok: false,
		message: 'No puedes quitarte el rol de Administrador'
	});
});

test('only the currently employed without a login can be given one', async () => {
	const carlos = await hire('Carlos Vélez', '71384902');
	const jorge = await hire('Jorge Salamanca', '98552017');
	await hire('Ana Pérez', '1036452118');
	await endEmployment(db, { id: jorge, end: '2026-03-31' }, admin);
	await create({ ...bodega, employee_id: String(carlos) });

	expect(await listEmployeesWithoutLogin(db, admin)).toEqual([{ id: 3, fullName: 'Ana Pérez' }]);
	for (const employeeId of [carlos, jorge]) {
		expect(await create({ ...bodega, username: 'otro', employee_id: String(employeeId) })).toEqual({
			ok: false,
			message: 'Ese empleado ya tiene login o no está trabajando'
		});
	}
});

test('setting a password ends the sessions and keeps the hash out of events', async () => {
	await create(bodega);
	await logInAs('bodega', 'clave-bodega');
	expect(sessionCount()).toBe(1);

	expect((await setPassword({ db, pepper }, { id: 1, password: 'clave-nueva' }, admin)).ok).toBe(
		true
	);
	expect(sessionCount()).toBe(0);
	expect(await logInAs('bodega', 'clave-bodega')).toBeNull();
	expect(await logInAs('bodega', 'clave-nueva')).not.toBeNull();
	expect(lastEvent()).toMatchObject({ action: 'PASSWORD_SET', before: '{}', after: '{}' });
	const { password_hash } = database.prepare('select password_hash from users').get()!;
	const leaks = database
		.prepare('select 1 from events where after like ?')
		.all(`%${password_hash}%`);
	expect(leaks).toEqual([]);
});

test('reassigning moves the login, ends its sessions and leaves the previous employee as is', async () => {
	const carlos = await hire('Carlos Vélez', '71384902');
	const ana = await hire('Ana Pérez', '1036452118');
	await create({ ...bodega, employee_id: String(carlos) });
	await logInAs('bodega', 'clave-bodega');
	const carlosRow = () => database.prepare('select * from employees where id = ?').get(carlos);
	const before = carlosRow();

	const input = { id: 1, employee_id: String(ana), password: 'clave-de-ana' };
	expect((await reassignLogin({ db, pepper }, input, admin)).ok).toBe(true);

	expect((await getLogin(db, 1, admin))?.employee).toEqual({ id: ana, fullName: 'Ana Pérez' });
	expect(carlosRow()).toEqual(before);
	expect(sessionCount()).toBe(0);
	expect(await logInAs('bodega', 'clave-de-ana')).not.toBeNull();
	const event = lastEvent();
	expect(event?.action).toBe('EDITED');
	expect(JSON.parse(String(event?.before))).toEqual({ employee_id: carlos });
	expect(JSON.parse(String(event?.after))).toEqual({ employee_id: ana });
});

test('reassigning to the same employee is rejected', async () => {
	await create(bodega);
	const input = { id: 1, employee_id: '', password: 'clave-nueva' };
	expect(await reassignLogin({ db, pepper }, input, admin)).toEqual({
		ok: false,
		message: 'Escoge un empleado distinto al actual'
	});
});

test('deactivating keeps the row with active = 0 and ends its sessions', async () => {
	await create(bodega);
	await logInAs('bodega', 'clave-bodega');
	expect((await deactivateLogin(db, { id: 1 }, admin)).ok).toBe(true);

	expect(database.prepare('select active from users where id = 1').get()).toEqual({ active: 0 });
	expect(sessionCount()).toBe(0);
	expect(await logInAs('bodega', 'clave-bodega')).toBeNull();
	expect(await deactivateLogin(db, { id: 1 }, admin)).toEqual({
		ok: false,
		message: 'Este login ya está inactivo'
	});
});

test('reactivating lets the login in again with its password', async () => {
	await create(bodega);
	expect(await reactivateLogin(db, { id: 1 }, admin)).toEqual({
		ok: false,
		message: 'Este login ya está activo'
	});
	await deactivateLogin(db, { id: 1 }, admin);
	expect((await reactivateLogin(db, { id: 1 }, admin)).ok).toBe(true);

	expect(await logInAs('bodega', 'clave-bodega')).not.toBeNull();
	const event = lastEvent();
	expect(JSON.parse(String(event?.before))).toEqual({ active: 0 });
	expect(JSON.parse(String(event?.after))).toEqual({ active: 1 });
});

test('an admin cannot deactivate their own login', async () => {
	await create({ ...bodega, username: 'admin', roles: ['ADMIN'] });
	expect(await deactivateLogin(db, { id: 1 }, admin)).toEqual({
		ok: false,
		message: 'No puedes desactivar tu propio login'
	});
});

test('MANAGER cannot create, assign roles, set passwords, reassign, (de)activate or list', async () => {
	await expect(create(bodega, manager)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	await expect(updateRoles(db, { id: 1, roles: ['ADMIN'] }, manager)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
	const forbidden = (thrown: unknown) => isHttpError(thrown, 403);
	const password = { id: 1, password: 'clave-nueva' };
	await expect(setPassword({ db, pepper }, password, manager)).rejects.toSatisfy(forbidden);
	await expect(
		reassignLogin({ db, pepper }, { ...password, employee_id: '' }, manager)
	).rejects.toSatisfy(forbidden);
	await expect(deactivateLogin(db, { id: 1 }, manager)).rejects.toSatisfy(forbidden);
	await expect(reactivateLogin(db, { id: 1 }, manager)).rejects.toSatisfy(forbidden);
	await expect(listLogins(db, manager)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	await expect(listEmployeesWithoutLogin(db, manager)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
	expect(database.prepare('select count(*) as count from users').get()?.count).toBe(0);
});
