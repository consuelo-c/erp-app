import { expect, test } from 'vitest';
import {
	contactBadges,
	contactLabelsSchema,
	deleteLabelText,
	labelKeysSchema,
	makeLabelKey,
	noMatchText,
	type ContactLabel
} from './contact-labels';

const builtIn: ContactLabel[] = [
	{ key: 'TRANSPORTER', name: 'Transportador' },
	{ key: 'BANNED', name: 'Vetado' }
];

test('the setting takes unique keys and names, sorted by name, with both built-in etiquetas', () => {
	expect(contactLabelsSchema.safeParse(builtIn).success).toBe(true);
	const decorator = { key: 'DECORATOR', name: 'Decorador' };
	expect(contactLabelsSchema.safeParse([decorator, ...builtIn]).success).toBe(true);
	expect(contactLabelsSchema.safeParse([...builtIn, decorator]).success).toBe(false);
	expect(
		contactLabelsSchema.safeParse([{ key: 'BANNED', name: 'Bloqueado' }, ...builtIn]).success
	).toBe(false);
	expect(
		contactLabelsSchema.safeParse([...builtIn, { key: 'BANNED_2', name: 'vetado' }]).success
	).toBe(false);
	expect(contactLabelsSchema.safeParse([builtIn[0]]).success).toBe(false);
	expect(contactLabelsSchema.safeParse([builtIn[1]]).success).toBe(false);
	expect(
		contactLabelsSchema.safeParse([{ key: 'EMPLOYEE', name: 'Empleada' }, ...builtIn]).success
	).toBe(false);
});

test("a contact's labels: [] is valid, a repeated key is not", () => {
	expect(labelKeysSchema.safeParse([]).success).toBe(true);
	expect(labelKeysSchema.safeParse(['CHEF', 'BANNED']).success).toBe(true);
	expect(labelKeysSchema.safeParse(['CHEF', 'CHEF']).success).toBe(false);
});

const labels: ContactLabel[] = [
	{ key: 'BARISTA', name: 'Barista' },
	{ key: 'CHEF', name: 'Chef' },
	{ key: 'WAITER', name: 'Mesero' },
	...builtIn
];

test('Carlos Ruiz, an employee with Vetado, Chef, Mesero and Barista, reads «Vetado · Empleado · Barista +2»', () => {
	const carlos = { isEmployee: true, labels: ['BANNED', 'CHEF', 'WAITER', 'BARISTA'] };
	expect(contactBadges(carlos, labels)).toEqual({
		badges: [
			{ text: 'Vetado', tone: 'error' },
			{ text: 'Empleado', tone: 'info' },
			{ text: 'Barista' }
		],
		more: 2
	});
	expect(contactBadges({ isEmployee: false, labels: [] }, labels)).toEqual({ badges: [], more: 0 });
});

test('the empty texts name the etiqueta, or the employees', () => {
	const decorator = { key: 'DECORATOR', name: 'Decorador' };
	const employee = { key: 'EMPLOYEE', name: 'Empleado' };
	expect(noMatchText('', decorator)).toBe('Ningún contacto tiene la etiqueta Decorador.');
	expect(noMatchText('ana', decorator)).toBe('Nadie coincide con «ana» con la etiqueta Decorador.');
	expect(noMatchText('', employee)).toBe('Aún no hay ningún empleado.');
	expect(noMatchText('ana', employee)).toBe('Nadie coincide con «ana» entre los empleados.');
	expect(noMatchText('ana', undefined)).toBe('Nadie coincide con «ana».');
});

test("a new etiqueta's key comes from its name, with a suffix when taken", () => {
	expect(makeLabelKey('Proveedor de carpas', builtIn)).toBe('PROVEEDOR_DE_CARPAS');
	expect(makeLabelKey('Decoración', builtIn)).toBe('DECORACION');
	// The first «Decoración» renamed keeps its key, so a new one can't take it.
	const renamed = [{ key: 'DECORACION', name: 'Decoración de mesas' }, ...builtIn];
	expect(makeLabelKey('Decoración', renamed)).toBe('DECORACION_2');
	expect(makeLabelKey('Empleado', builtIn)).toBe('EMPLEADO');
	expect(makeLabelKey('employee', builtIn)).toBe('EMPLOYEE_2');
});

test('deleting asks with the count of contacts it is stripped from, or without one', () => {
	expect(deleteLabelText('Barista', 4)).toBe('Barista está en 4 contactos; se quita de todos.');
	expect(deleteLabelText('Chef', 1)).toBe('Chef está en 1 contacto; se quita de todos.');
	expect(deleteLabelText('Bartender', 0)).toBe('');
});
