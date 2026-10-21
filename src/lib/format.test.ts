import { expect, test } from 'vitest';
import {
	formatHours,
	formatIdNumber,
	formatPesos,
	formatPesosInWords,
	formatReceiptNumber,
	formatSignedPesos
} from './format';

test('pesos and ID numbers get a dot every three digits', () => {
	expect(formatPesos(1423500)).toBe('$1.423.500');
	expect(formatPesos(1500)).toBe('$1.500');
	expect(formatIdNumber('1036452118')).toBe('1.036.452.118');
});

test('worked minutes read as hours with one decimal', () => {
	expect(formatHours(486)).toBe('8.1 h');
	expect(formatHours(0)).toBe('0.0 h');
});

test('receipt numbers print with four digits and grow past them', () => {
	expect(formatReceiptNumber(89)).toBe('0089');
	expect(formatReceiptNumber(12345)).toBe('12345');
});

test('a movement shows its sign: plus in, a minus sign out', () => {
	expect(formatSignedPesos(680000)).toBe('+$680.000');
	expect(formatSignedPesos(-222000)).toBe('−$222.000');
});

test.each([
	[100, 'Cien pesos m/cte'],
	[101, 'Ciento un pesos m/cte'],
	[21000, 'Veintiún mil pesos m/cte'],
	[48500, 'Cuarenta y ocho mil quinientos pesos m/cte'],
	[100000, 'Cien mil pesos m/cte'],
	[1000000, 'Un millón de pesos m/cte'],
	[2000000, 'Dos millones de pesos m/cte'],
	[1750905, 'Un millón setecientos cincuenta mil novecientos cinco pesos m/cte'],
	[
		9999999,
		'Nueve millones novecientos noventa y nueve mil novecientos noventa y nueve pesos m/cte'
	],
	[-417954, 'Cuatrocientos diecisiete mil novecientos cincuenta y cuatro pesos m/cte']
])('%i pesos read «%s»', (pesos, words) => {
	expect(formatPesosInWords(pesos)).toBe(words);
});
