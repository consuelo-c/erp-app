import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { logIn } from './auth';
import { createEmployee, endEmployment } from './employees';
import {
	createLogin,
	getLogin,
	listEmployeesWithoutLogin,
	listLogins,
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
	const input = { full_name: fullName, id_number: idNumber, monthly_salary: '1423500' };
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
	const session = await logIn(
		db,
		{ username: 'bodega', password: 'clave-bodega' },
		{ secrets: { pepper }, request: { ip: null, userAgent: null } }
	);
	expect(session).not.toBeNull();
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

test('MANAGER cannot create logins, assign roles or list them', async () => {
	await expect(create(bodega, manager)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	await expect(updateRoles(db, { id: 1, roles: ['ADMIN'] }, manager)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
	await expect(listLogins(db, manager)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	await expect(listEmployeesWithoutLogin(db, manager)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
	expect(database.prepare('select count(*) as count from users').get()?.count).toBe(0);
});
