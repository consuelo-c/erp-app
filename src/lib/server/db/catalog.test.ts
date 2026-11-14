import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';

const catalog = readFileSync('scripts/catalog.sql', 'utf8');

let database: DatabaseSync;

beforeEach(() => {
	database = new DatabaseSync(':memory:');
	const files = readdirSync('migrations')
		.filter((file) => file.endsWith('.sql'))
		.sort();
	for (const file of files) {
		database.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
	database.exec(catalog);
});

function readProducts() {
	return database.prepare('select * from products order by id').all();
}

function quantityOf(name: string) {
	return database.prepare('select total_quantity from products where name = ?').get(name)
		?.total_quantity;
}

test('loads the thirteen variant groups at their prices, every variant a linen', () => {
	const groups = database
		.prepare(
			`select variant_group, min(rental_price) as low, max(rental_price) as high, min(category) as category
			from products where variant_group is not null group by variant_group order by variant_group`
		)
		.all();
	expect(groups.map((group) => [group.variant_group, group.low, group.high, group.category])).toEqual(
		[
			['Caminos de mesa', 8000, 8000, 'LINENS'],
			['Fajones para vestidos de silla', 1800, 1800, 'LINENS'],
			['Forros para sillas', 3800, 3800, 'LINENS'],
			['Manteles para Mesas Cuadradas', 7000, 7000, 'LINENS'],
			['Manteles para Mesas Redondas de 1 metro', 10000, 10000, 'LINENS'],
			['Manteles para Mesas Redondas de 1.20 diámetro', 16000, 16000, 'LINENS'],
			['Manteles para Tablones', 9000, 9000, 'LINENS'],
			['Manteles para Tablones Doble', 16000, 16000, 'LINENS'],
			['Pañoletas', 1500, 1500, 'LINENS'],
			['Ruches', 16000, 16000, 'LINENS'],
			['Servilletas de Tela', 1500, 1500, 'LINENS'],
			['Sobremanteles 75cm X 75cm para mesa cuadrada', 3000, 3000, 'LINENS'],
			['Sobremanteles Redondos', 10000, 10000, 'LINENS']
		]
	);
	const misnamed = readProducts().filter(
		(product) =>
			null !== product.variant_group &&
			`${product.variant_group} — ${product.variant_name}` !== product.name
	);
	expect(misnamed).toEqual([]);
	expect(quantityOf('Manteles para Tablones — Rojo')).toBe(21);
});

test('«Alquiler» leaves three names; a group’s own product, Catering, a variation and the imported overlays stay out', () => {
	const names = readProducts().map((product) => product.name);
	expect(names).toEqual(
		expect.arrayContaining(['Caminos de mesa — Yute', 'Forros para sillas — Beige', 'Sillas Tiffany'])
	);
	const absent = [
		'Manteles para Tablones',
		'Alquiler de caminos de mesa',
		'Alquiler de forros para sillas',
		'Sillas Tiffany en alquiler',
		'Sobremanteles Redondos Importados',
		'Desayuno',
		'Plato Fuerte',
		'Pasabocas',
		'Desayuno - Sin jugo de Naranja',
		'Cubiertos dorados'
	];
	expect(absent.filter((name) => names.includes(name))).toEqual([]);
	expect(names.filter((name) => 'Cucharón grande' === name)).toHaveLength(1);
	expect(quantityOf('Sillas Tiffany')).toBe(0);
});

test('the two in spandex are plain products with their counts, and an unpublished one is inactive', () => {
	const plain = database
		.prepare(
			"select name, variant_group, total_quantity from products where name like '%Spandex' order by name"
		)
		.all();
	expect(plain).toEqual([
		{ name: 'Espaldar para Silla en Spandex', variant_group: null, total_quantity: 160 },
		{ name: 'Forros para Sillas en Spandex', variant_group: null, total_quantity: 151 }
	]);
	const inactive = database.prepare('select name from products where active = 0 order by name');
	expect(inactive.all().map((product) => product.name)).toEqual([
		'Banca y Mesas Para Picnic',
		'Cuchillos dorados',
		'Tenedores dorados',
		'Tortera de lujo',
		'Tortera grande'
	]);
});

test('the colors are tidied, and «Dorados» on MOÑOS falls back to its INVENTA', () => {
	expect(catalog).not.toMatch(/Blaco|Jackard|Turqueza|Hawianos|confinte|hortencia/i);
	expect(quantityOf('Fajones para vestidos de silla — Dorado')).toBe(143);
	expect(quantityOf('Manteles para Mesas Cuadradas — Cuadros azul rey')).toBe(0);
});

test('a description keeps its line breaks', () => {
	const product = database.prepare("select description from products where name = 'Tablones'");
	expect(String(product.get()?.description)).toContain('personas.\n\nMedida: 1.80');
});

test('a second run inserts nothing; every row is created by system and writes no events', () => {
	database.exec("update products set rental_price = 9500 where name = 'Tablones'");
	const before = readProducts();
	database.exec(catalog);
	expect(readProducts()).toEqual(before);
	for (const product of before) {
		expect([product.created_by, product.updated_by]).toEqual(['system', 'system']);
	}
	expect(database.prepare('select count(*) as count from events').get()).toEqual({ count: 0 });
});
