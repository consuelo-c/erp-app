import { expect, test } from 'vitest';
import { createMemoryD1 } from '../src/lib/server/db/memory-d1';
import { parseCsv, toPlainText, toProducts, toSql } from './convert-wc-catalog.js';

const record = (fields) => ({
	ID: '1',
	Tipo: 'simple',
	Nombre: 'Copas para Agua',
	Publicado: '1',
	Categorías: 'Cristalería',
	'Precio normal': '980',
	'Descripción corta': '',
	Descripción: '',
	...fields
});

test('parses quoted fields with commas, newlines and doubled quotes', () => {
	expect(parseCsv('a,b\r\n"x, y","line\nnext ""quoted"""\n')).toEqual([
		['a', 'b'],
		['x, y', 'line\nnext "quoted"']
	]);
});

test('turns the HTML description into plain text', () => {
	expect(
		toPlainText('<h2>Sillas.</h2>\n\\n<ul>\n\\n \t<li>Incluyen&nbsp;cojín.</li>\n\\n</ul>')
	).toBe('Sillas.\n\nIncluyen cojín.');
	expect(toPlainText('<p><br data-mce-bogus="1"></p>')).toBeNull();
});

test('maps simple products and skips variations, Catering, no price and repeated names', () => {
	const { products, skipped } = toProducts([
		record({ 'Descripción corta': '<b>Para agua</b>' }),
		record({
			ID: '2',
			Nombre: 'Bowl',
			Categorías: 'Elementos de Decoración, Samovares y bandejas',
			Publicado: '-1',
			Descripción: 'Larga'
		}),
		record({ ID: '3', Tipo: 'variation' }),
		record({ ID: '4', Nombre: 'Desayuno', Categorías: 'Catering' }),
		record({ ID: '5', Nombre: 'Cubiertos dorados', 'Precio normal': '' }),
		record({ ID: '6', Nombre: 'copas para agua' })
	]);
	expect(products).toEqual([
		{
			name: 'Copas para Agua',
			category: 'GLASSWARE',
			description: 'Para agua',
			rentalPrice: 980,
			active: 1
		},
		{ name: 'Bowl', category: 'DECOR', description: 'Larga', rentalPrice: 980, active: 0 }
	]);
	expect(skipped.map((line) => line.split(' ')[0])).toEqual(['3', '4', '5', '6']);
});

test('the SQL loads into the migrated products table once, skipping existing names', () => {
	const { database } = createMemoryD1();
	const sql = toSql([
		{ name: "Copa d'oro", category: 'GLASSWARE', description: null, rentalPrice: 980, active: 1 },
		{ name: 'Bowl', category: 'DECOR', description: 'Grande', rentalPrice: 3000, active: 0 }
	]);
	database.exec(sql);
	database.exec(sql);
	expect(
		database.prepare('select name, total_quantity, active, created_by from products').all()
	).toEqual([
		{ name: "Copa d'oro", total_quantity: 0, active: 1, created_by: 'system' },
		{ name: 'Bowl', total_quantity: 0, active: 0, created_by: 'system' }
	]);
});
