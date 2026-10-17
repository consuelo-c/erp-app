import { expect, test } from 'vitest';
import { formatHours, formatIdNumber, formatPesos } from './format';

test('pesos and ID numbers get a dot every three digits', () => {
	expect(formatPesos(1423500)).toBe('$1.423.500');
	expect(formatPesos(1500)).toBe('$1.500');
	expect(formatIdNumber('1036452118')).toBe('1.036.452.118');
});

test('worked minutes read as hours with one decimal', () => {
	expect(formatHours(486)).toBe('8.1 h');
	expect(formatHours(0)).toBe('0.0 h');
});
