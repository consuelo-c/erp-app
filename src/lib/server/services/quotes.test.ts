import { expect, test } from 'vitest';
import { quoteAttributesSchema } from './quotes';

test('attributes take the event address and the notes, every key optional, and nothing else', () => {
	const accepts = (attributes: unknown) => quoteAttributesSchema.safeParse(attributes).success;
	expect(accepts({})).toBe(true);
	expect(accepts({ notes: 'Precios incluyen montaje y desmontaje' })).toBe(true);
	expect(accepts({ address_1: 'Hacienda Fizebad, km 38 vía Las Palmas' })).toBe(true);
	expect(
		accepts({ address_1: 'Hacienda Fizebad, km 38 vía Las Palmas', address_2: 'Salón principal' })
	).toBe(true);
	expect(accepts({ address_2: 'Salón principal' })).toBe(false);
	expect(accepts({ notes: 'x', status: 'REJECTED' })).toBe(false);
	expect(accepts({ notes: '' })).toBe(false);
});
