import { expect, test } from 'vitest';
import {
	findCurrentHref,
	findPageLabel,
	findSheetParent,
	getBarSlots,
	getMenu,
	getPageNumbers,
	hasSheetList,
	type MenuEntry
} from './navigation';

/** A login's menu as `Parent: Child, Child`, one line per parent. */
function outline(menu: MenuEntry[]): string[] {
	return menu.map(({ label, children }) =>
		[label, children.map((child) => child.label).join(', ')].filter(Boolean).join(': ')
	);
}

test('ADMIN sees the whole tree, in its order', () => {
	expect(outline(getMenu(['ADMIN']))).toEqual([
		'Despachos',
		'Cotizaciones: Pedidos',
		'Productos: Nuevo conteo, Confirmar conteo',
		'Contactos',
		'Pagos: Cuentas de cobro, Movimiento, Entregas de efectivo',
		'Personal: Nómina, Horas, Logins',
		'Reportes: Planilla horas, Movimientos caja',
		'Ayuda',
		'Configuración: Nómina, Festivos, Ayuda, Términos, Etiquetas'
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
		'Efectivo por entregar',
		'Personal: Horas',
		'Ayuda'
	]);
	expect(outline(getMenu(['WAREHOUSE']))).toEqual([
		'Despachos',
		'Productos: Nuevo conteo',
		'Personal: Horas',
		'Ayuda'
	]);
	expect(outline(getMenu(['DRIVER']))).toEqual([
		'Despachos',
		'Productos: Nuevo conteo',
		'Efectivo por entregar',
		'Personal: Horas',
		'Ayuda'
	]);
	expect(outline(getMenu(['SALES', 'WAREHOUSE']))).toContain('Productos: Nuevo conteo');
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

test('the bar is Despachos · Horas · Nuevo conteo; Sales alone gets Productos; a slot nobody opens goes', () => {
	const slots = (roles: Parameters<typeof getMenu>[0]) =>
		getBarSlots(getMenu(roles)).map(({ label, href }) => `${label} ${href}`);
	expect(slots(['ADMIN'])).toEqual([
		'Despachos /despachos',
		'Horas /horas',
		'Nuevo conteo /inventario'
	]);
	expect(slots(['WAREHOUSE'])).toEqual(slots(['ADMIN']));
	expect(slots(['SALES'])).toEqual([
		'Despachos /despachos',
		'Horas /horas',
		'Productos /productos'
	]);
	expect(slots(['SALES', 'DRIVER'])).toEqual(slots(['ADMIN']));
	expect(slots([])).toEqual(['Despachos /despachos', 'Horas /horas']);
});

test('a bar slot is current only on its own page: Confirmar conteo and Planilla horas mark «Más»', () => {
	const menu = getMenu(['ADMIN']);
	const currentSlot = (pathname: string) =>
		getBarSlots(menu).find(({ href }) => href === findCurrentHref(menu, pathname))?.label;
	expect(currentSlot('/inventario')).toBe('Nuevo conteo');
	expect(currentSlot('/horas/empleado')).toBe('Horas');
	expect(currentSlot('/inventario/revisar')).toBeUndefined();
	expect(currentSlot('/horas/equipo')).toBeUndefined();
	expect(currentSlot('/contactos')).toBeUndefined();
});

test("the «Más» sheet opens on the current parent's list, or on the first list", () => {
	const menu = getMenu(['ADMIN']);
	expect(findSheetParent(menu, findCurrentHref(menu, '/caja/registrar'))?.label).toBe('Pagos');
	expect(findSheetParent(menu, findCurrentHref(menu, '/productos/12'))?.label).toBe('Productos');
	expect(findSheetParent(menu, findCurrentHref(menu, '/contactos'))).toBeUndefined();
	expect(findSheetParent(menu, findCurrentHref(menu, '/caja'))?.label).toBe('Reportes');
	// A section outside the login's roles has no current page.
	expect(findSheetParent(menu, undefined)).toBeUndefined();
});

test('a parent with one page the login opens is a plain row to that page', () => {
	const personal = (roles: Parameters<typeof getMenu>[0]) =>
		getMenu(roles).find(({ label }) => 'Personal' === label) as MenuEntry;
	expect(hasSheetList(personal(['ADMIN']))).toBe(true);
	expect(hasSheetList(personal([]))).toBe(false);
	expect(personal([]).href).toBe('/horas');
});

test('the no-permission screen is titled by the menu page that holds the path', () => {
	expect(findPageLabel('/personal')).toBe('Personal');
	expect(findPageLabel('/personal/7')).toBe('Personal');
	expect(findPageLabel('/caja/registrar')).toBe('Movimiento');
	expect(findPageLabel('/horas/equipo')).toBe('Planilla horas');
	expect(findPageLabel('/configuracion/nomina')).toBe('Nómina');
	expect(findPageLabel('/')).toBeUndefined();
});

test('the pagination shows the first, the last and the neighbors of the current page', () => {
	expect(getPageNumbers(1, 1)).toEqual([1]);
	expect(getPageNumbers(2, 2)).toEqual([1, 2]);
	expect(getPageNumbers(1, 8)).toEqual([1, 2, null, 8]);
	expect(getPageNumbers(5, 8)).toEqual([1, null, 4, 5, 6, 7, 8]);
	expect(getPageNumbers(4, 8)).toEqual([1, 2, 3, 4, 5, null, 8]);
	expect(getPageNumbers(8, 8)).toEqual([1, null, 7, 8]);
});

test('«Efectivo por entregar» is for drivers and Sales reps, never for managers, admins or the warehouse', () => {
	const hasTab = (roles: Parameters<typeof getMenu>[0]) =>
		getMenu(roles).some(
			({ label, href }) => 'Efectivo por entregar' === label && '/efectivo' === href
		);
	expect(hasTab(['DRIVER'])).toBe(true);
	expect(hasTab(['SALES'])).toBe(true);
	expect(hasTab(['WAREHOUSE', 'DRIVER'])).toBe(true);
	expect(hasTab(['WAREHOUSE'])).toBe(false);
	expect(hasTab(['MANAGER'])).toBe(false);
	expect(hasTab(['ADMIN'])).toBe(false);
	expect(hasTab(['SALES', 'MANAGER'])).toBe(false);
	expect(hasTab(['ADMIN', 'DRIVER'])).toBe(false);
	expect(findPageLabel('/efectivo')).toBe('Efectivo por entregar');
});

test("«Entregas de efectivo» is in Caja's menu for managers and admins only", () => {
	const hasHandovers = (roles: Parameters<typeof getMenu>[0]) =>
		getMenu(roles)
			.flatMap(({ children }) => children)
			.some(({ label, href }) => 'Entregas de efectivo' === label && '/caja/entregas' === href);
	expect(hasHandovers(['ADMIN'])).toBe(true);
	expect(hasHandovers(['MANAGER'])).toBe(true);
	expect(hasHandovers(['SALES', 'MANAGER'])).toBe(true);
	expect(hasHandovers(['SALES'])).toBe(false);
	expect(hasHandovers(['DRIVER'])).toBe(false);
	expect(hasHandovers(['WAREHOUSE'])).toBe(false);
	expect(findPageLabel('/caja/entregas/registrar')).toBe('Entregas de efectivo');
	expect(findPageLabel('/caja')).toBe('Movimientos caja');
});
