import { expect, test } from 'vitest';
import {
	BAR_SLOTS,
	DESTINATIONS,
	findCurrentHref,
	findDestination,
	getMenu,
	getPageNumbers,
	type MenuEntry
} from './navigation';

/** A login's menu as `Parent: Child, Child`, one line per parent. */
function outline(menu: MenuEntry[]): string[] {
	return menu.map(({ label, children }) =>
		[label, children.map((child) => child.label).join(', ')].filter(Boolean).join(': ')
	);
}

test('a path belongs to the destination that holds it, Personal and Nómina apart', () => {
	expect(findDestination('/despachos')?.label).toBe('Despachos');
	expect(findDestination('/horas/2026-07-30')?.label).toBe('Horas');
	expect(findDestination('/pedidos/1043')?.label).toBe('Pedidos');
	expect(findDestination('/personal/7')?.label).toBe('Personal');
	expect(findDestination('/nomina/comprobante')?.label).toBe('Nómina');
	expect(findDestination('/inventario/revisar/3')?.label).toBe('Inventario');
	expect(findDestination('/')).toBeUndefined();
});

test('Cotizaciones follows Pedidos: the first in «Más», after Pedidos in the sidebar', () => {
	const labels = DESTINATIONS.map((destination) => destination.label);
	expect(labels.slice(BAR_SLOTS - 1, BAR_SLOTS + 2)).toEqual([
		'Pedidos',
		'Cotizaciones',
		'Cuentas de cobro'
	]);
	expect(findDestination('/cotizaciones/12/editar')).toMatchObject({ icon: 'file' });
});

test('Cuentas de cobro follows Cotizaciones, with an icon of its own', () => {
	const labels = DESTINATIONS.map((destination) => destination.label);
	expect(labels.slice(BAR_SLOTS, BAR_SLOTS + 3)).toEqual([
		'Cotizaciones',
		'Cuentas de cobro',
		'Contactos'
	]);
	expect(findDestination('/cuentas-de-cobro/4794')).toMatchObject({ icon: 'receipt' });
});

test('Logins is its own destination, outside Configuración, whose tabs keep Nómina', () => {
	expect(findDestination('/logins/3/contrasena')?.label).toBe('Logins');
	expect(findDestination('/loginsx')).toBeUndefined();
	expect(findDestination('/configuracion/nomina')?.label).toBe('Configuración');
});

test('ADMIN sees the whole tree, in its order', () => {
	expect(outline(getMenu(['ADMIN']))).toEqual([
		'Despachos',
		'Cotizaciones: Pedidos',
		'Productos: Conteos, Revisiones',
		'Contactos',
		'Pagos: Cuentas de cobro, Movimiento, Caja',
		'Personal: Nómina, Horas, Logins',
		'Reportes: Planilla horas',
		'Ayuda',
		'Configuración: Nómina, Festivos, Ayuda, Términos'
	]);
});

test('each role sees only what it opens; two roles see the union', () => {
	expect(outline(getMenu(['MANAGER']))).toContain('Personal: Nómina, Horas');
	expect(outline(getMenu(['SALES']))).toEqual([
		'Despachos',
		'Cotizaciones: Pedidos',
		'Productos',
		'Contactos',
		'Pagos: Cuentas de cobro',
		'Personal: Horas',
		'Ayuda'
	]);
	expect(outline(getMenu(['WAREHOUSE']))).toEqual([
		'Despachos',
		'Productos: Conteos',
		'Personal: Horas',
		'Ayuda'
	]);
	expect(outline(getMenu(['DRIVER']))).toEqual(outline(getMenu(['WAREHOUSE'])));
	expect(outline(getMenu(['SALES', 'WAREHOUSE']))).toContain('Productos: Conteos');
});

test('a parent without its own page, or one the login cannot open, opens its first child', () => {
	const admin = getMenu(['ADMIN']);
	expect(admin.find(({ label }) => 'Pagos' === label)?.href).toBe('/cuentas-de-cobro');
	expect(admin.find(({ label }) => 'Reportes' === label)?.href).toBe('/horas/equipo');
	expect(admin.find(({ label }) => 'Configuración' === label)?.href).toBe('/configuracion');
	const noRole = getMenu([]);
	expect(outline(noRole)).toEqual(['Despachos', 'Personal: Horas', 'Ayuda']);
	expect(noRole.find(({ label }) => 'Personal' === label)).toMatchObject({
		href: '/horas',
		ownHref: undefined
	});
	expect(getMenu(['WAREHOUSE']).find(({ label }) => 'Productos' === label)?.href).toBe(
		'/inventario'
	);
});

test('the most specific path is the current page', () => {
	const menu = getMenu(['ADMIN']);
	expect(findCurrentHref(menu, '/horas/equipo')).toBe('/horas/equipo');
	expect(findCurrentHref(menu, '/horas/empleado')).toBe('/horas');
	expect(findCurrentHref(menu, '/caja/registrar')).toBe('/caja/registrar');
	expect(findCurrentHref(menu, '/caja')).toBe('/caja');
	expect(findCurrentHref(menu, '/inventario/revisar/3')).toBe('/inventario/revisar');
	expect(findCurrentHref(menu, '/configuracion/nomina')).toBe('/configuracion/nomina');
	expect(findCurrentHref(menu, '/nomina/comprobante')).toBe('/nomina');
	expect(findCurrentHref(menu, '/')).toBeUndefined();
	expect(findCurrentHref(getMenu(['SALES']), '/caja')).toBeUndefined();
});

test('the pagination shows the first, the last and the neighbors of the current page', () => {
	expect(getPageNumbers(1, 1)).toEqual([1]);
	expect(getPageNumbers(2, 2)).toEqual([1, 2]);
	expect(getPageNumbers(1, 8)).toEqual([1, 2, null, 8]);
	expect(getPageNumbers(5, 8)).toEqual([1, null, 4, 5, 6, 7, 8]);
	expect(getPageNumbers(4, 8)).toEqual([1, 2, 3, 4, 5, null, 8]);
	expect(getPageNumbers(8, 8)).toEqual([1, null, 7, 8]);
});
