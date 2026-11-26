import { z } from 'zod';
import { expect, test } from 'vitest';
import { CHECK_FIELDS, fieldsRefusal, invalid, messageRefusal, refusal } from './result';

function zodErrorOf(schema: z.ZodType, input: unknown): z.ZodError {
	const parsed = schema.safeParse(input);
	if (parsed.success) {
		throw new Error('expected the input to fail');
	}
	return parsed.error;
}

test('invalid keys a nested issue by its whole path and a flat one by its name', () => {
	const schema = z.object({
		name: z.string('Escribe el nombre'),
		order_items: z.array(z.object({ qty: z.number('Escribe la cantidad') }))
	});
	const error = zodErrorOf(schema, { order_items: [{ qty: 1 }, { qty: 2 }, {}] });
	expect(invalid(error)).toEqual({
		ok: false,
		message: CHECK_FIELDS,
		errors: { name: 'Escribe el nombre', 'order_items.2.qty': 'Escribe la cantidad' }
	});
});

test('refusal marks one field under the default message', () => {
	expect(refusal('client_id', 'Ese cliente no existe')).toEqual({
		ok: false,
		message: CHECK_FIELDS,
		errors: { client_id: 'Ese cliente no existe' }
	});
});

test('fieldsRefusal marks several fields under the default message', () => {
	expect(fieldsRefusal({ 'items.0.qty': 'Muy alto', 'items.1.qty': 'Muy bajo' })).toEqual({
		ok: false,
		message: CHECK_FIELDS,
		errors: { 'items.0.qty': 'Muy alto', 'items.1.qty': 'Muy bajo' }
	});
});

test('messageRefusal carries its own message and marks no field', () => {
	expect(messageRefusal('Esa cotización no existe')).toEqual({
		ok: false,
		message: 'Esa cotización no existe',
		errors: {}
	});
});

test('messageRefusal marks the field it names with its own message', () => {
	expect(messageRefusal('Esa persona no tiene efectivo por entregar', 'username')).toEqual({
		ok: false,
		message: 'Esa persona no tiene efectivo por entregar',
		errors: { username: 'Esa persona no tiene efectivo por entregar' }
	});
});
