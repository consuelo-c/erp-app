import type { ComponentProps } from 'svelte';
import { resolve } from '$app/paths';
import type Icon from '$lib/components/Icon.svelte';
import type { Role } from '$lib/server/actor';

type IconName = ComponentProps<typeof Icon>['name'];

/** A menu destination. No `href` until the phase that builds its screens: shown, but disabled. */
export type Destination = {
	label: string;
	icon: IconName;
	href?: string;
	/** Paths under this destination, its own included: which entry is current. */
	paths?: string[];
};

// STUB: «Barra inferior y hoja «Más» con el árbol» (#554, Phase 21) replaces the bottom bar and the
// «Más» sheet, the last users of DESTINATIONS, BAR_SLOTS, HELP and findDestination, with MENU.
export const DESTINATIONS: Destination[] = [
	{
		label: 'Despachos',
		icon: 'truck',
		href: resolve('/despachos'),
		paths: [resolve('/despachos')]
	},
	{
		label: 'Horas',
		icon: 'clock',
		href: resolve('/horas'),
		paths: [resolve('/horas')]
	},
	{
		label: 'Pedidos',
		icon: 'list',
		href: resolve('/pedidos'),
		paths: [resolve('/pedidos')]
	},
	{
		label: 'Cotizaciones',
		icon: 'file',
		href: resolve('/cotizaciones'),
		paths: [resolve('/cotizaciones')]
	},
	{
		label: 'Cuentas de cobro',
		icon: 'receipt',
		href: resolve('/cuentas-de-cobro'),
		paths: [resolve('/cuentas-de-cobro')]
	},
	{
		label: 'Contactos',
		icon: 'contact',
		href: resolve('/contactos'),
		paths: [resolve('/contactos')]
	},
	{
		label: 'Productos',
		icon: 'package',
		href: resolve('/productos'),
		paths: [resolve('/productos')]
	},
	{
		label: 'Inventario',
		icon: 'clipboard',
		href: resolve('/inventario'),
		paths: [resolve('/inventario')]
	},
	{
		label: 'Caja',
		icon: 'wallet',
		href: resolve('/caja/registrar'),
		paths: [resolve('/caja')]
	},
	{
		label: 'Personal',
		icon: 'users',
		href: resolve('/personal'),
		paths: [resolve('/personal')]
	},
	{
		label: 'Nómina',
		icon: 'banknote',
		href: resolve('/nomina'),
		paths: [resolve('/nomina')]
	},
	{
		label: 'Logins',
		icon: 'lock',
		href: resolve('/logins'),
		paths: [resolve('/logins')]
	},
	{
		label: 'Configuración',
		icon: 'settings',
		href: resolve('/configuracion'),
		paths: [resolve('/configuracion')]
	}
];

/** How many destinations fit the bottom bar before «Más». */
export const BAR_SLOTS = 3;

/** Not a destination: it lives in «Más» and at the sidebar's foot. */
export const HELP: Destination = { label: 'Ayuda', icon: 'help', href: resolve('/ayuda') };

export function findDestination(pathname: string): Destination | undefined {
	return DESTINATIONS.find(({ paths = [] }) =>
		paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
	);
}

/** A page of the menu tree, with the roles its route lets in; without `roles`, every login. */
type MenuPage = { label: string; href: string; roles?: readonly Role[] };

/** A parent of the menu tree: Pagos and Reportes have no page of their own. */
type MenuParent = {
	label: string;
	icon: IconName;
	page?: Omit<MenuPage, 'label'>;
	children: MenuPage[];
};

/** A parent as one login sees it: `href` is its own page, or else its first child it can open. */
export type MenuEntry = {
	label: string;
	icon: IconName;
	href: string;
	ownHref?: string;
	children: { label: string; href: string }[];
};

const MANAGERS = ['ADMIN', 'MANAGER'] as const;
const SELLERS = ['ADMIN', 'MANAGER', 'SALES'] as const;

/** The menu tree, in its order. Each page's `roles` copy its route's `requireRole`. */
const MENU: MenuParent[] = [
	{ label: 'Despachos', icon: 'truck', page: { href: resolve('/despachos') }, children: [] },
	{
		label: 'Cotizaciones',
		icon: 'file',
		page: { href: resolve('/cotizaciones'), roles: SELLERS },
		children: [{ label: 'Pedidos', href: resolve('/pedidos'), roles: SELLERS }]
	},
	{
		label: 'Productos',
		icon: 'package',
		page: { href: resolve('/productos'), roles: SELLERS },
		children: [
			{
				label: 'Conteos',
				href: resolve('/inventario'),
				roles: [...MANAGERS, 'WAREHOUSE', 'DRIVER']
			},
			{ label: 'Revisiones', href: resolve('/inventario/revisar'), roles: MANAGERS }
		]
	},
	{
		label: 'Contactos',
		icon: 'contact',
		page: { href: resolve('/contactos'), roles: SELLERS },
		children: []
	},
	{
		label: 'Pagos',
		icon: 'wallet',
		children: [
			{ label: 'Cuentas de cobro', href: resolve('/cuentas-de-cobro'), roles: SELLERS },
			{ label: 'Movimiento', href: resolve('/caja/registrar'), roles: MANAGERS },
			{ label: 'Caja', href: resolve('/caja'), roles: MANAGERS }
		]
	},
	{
		label: 'Personal',
		icon: 'users',
		page: { href: resolve('/personal'), roles: MANAGERS },
		children: [
			{ label: 'Nómina', href: resolve('/nomina'), roles: MANAGERS },
			{ label: 'Horas', href: resolve('/horas') },
			{ label: 'Logins', href: resolve('/logins'), roles: ['ADMIN'] }
		]
	},
	{
		label: 'Reportes',
		icon: 'chart',
		children: [{ label: 'Planilla horas', href: resolve('/horas/equipo'), roles: MANAGERS }]
	},
	{ label: 'Ayuda', icon: 'help', page: { href: resolve('/ayuda') }, children: [] },
	{
		label: 'Configuración',
		icon: 'settings',
		page: { href: resolve('/configuracion'), roles: MANAGERS },
		children: [
			{ label: 'Nómina', href: resolve('/configuracion/nomina'), roles: MANAGERS },
			{ label: 'Festivos', href: resolve('/configuracion/festivos'), roles: MANAGERS },
			{ label: 'Ayuda', href: resolve('/configuracion/ayuda'), roles: MANAGERS },
			{ label: 'Términos', href: resolve('/configuracion/terminos'), roles: MANAGERS }
		]
	}
];

function canOpen(page: { roles?: readonly Role[] }, roles: readonly Role[]): boolean {
	return undefined === page.roles || page.roles.some((role) => roles.includes(role));
}

/** The menu one login sees: only what its roles open, and no parent left with nothing to open. */
export function getMenu(roles: readonly Role[]): MenuEntry[] {
	return MENU.flatMap(({ label, icon, page, children }) => {
		const ownPage = page && canOpen(page, roles) ? page : undefined;
		const openChildren = children
			.filter((child) => canOpen(child, roles))
			.map((child) => ({ label: child.label, href: child.href }));
		const href = ownPage?.href ?? openChildren[0]?.href;
		if (undefined === href) {
			return [];
		}
		return [{ label, icon, href, ownHref: ownPage?.href, children: openChildren }];
	});
}

/** The href of the menu page that holds the path: the most specific, so Planilla horas beats Horas. */
export function findCurrentHref(menu: MenuEntry[], pathname: string): string | undefined {
	return menu
		.flatMap(({ ownHref, children }) => [ownHref, ...children.map(({ href }) => href)])
		.filter((href) => undefined !== href)
		.filter((href) => pathname === href || pathname.startsWith(`${href}/`))
		.sort((first, second) => second.length - first.length)[0];
}

/** Horas' tabs, for the logins that log everyone's hours. */
export const HOURS_TABS = [
	{ label: 'Empleado', href: resolve('/horas/empleado') },
	{ label: 'Equipo', href: resolve('/horas/equipo') }
];

/** Caja's tabs: the entry of a movement no other module records, and the book. */
export const CASH_TABS = [
	{ label: 'Registrar movimiento', shortLabel: 'Registrar', href: resolve('/caja/registrar') },
	{ label: 'Libro de caja', href: resolve('/caja') }
];

/** Inventario's tabs, for the logins that review counts. */
export const INVENTORY_TABS = [
	{ label: 'Conteo físico', href: resolve('/inventario') },
	{ label: 'Revisar conteo', href: resolve('/inventario/revisar') }
];

/** Configuración's tabs: the general and payroll settings, and the holidays, help and terms editors. */
export const SETTINGS_TABS = [
	{ label: 'General', href: resolve('/configuracion') },
	{ label: 'Nómina', href: resolve('/configuracion/nomina') },
	{ label: 'Festivos', href: resolve('/configuracion/festivos') },
	{ label: 'Ayuda', href: resolve('/configuracion/ayuda') },
	{ label: 'Términos', href: resolve('/configuracion/terminos') }
];

/**
 * The page numbers a pagination shows: the first, the last, and the current one with its
 * neighbors; `null` is an ellipsis for the pages skipped, never for a single one.
 */
export function getPageNumbers(current: number, count: number): (number | null)[] {
	const shown = [...new Set([1, current - 1, current, current + 1, count])]
		.filter((pageNumber) => 1 <= pageNumber && pageNumber <= count)
		.sort((first, second) => first - second);
	return shown.flatMap((pageNumber, index) => {
		const gap = pageNumber - (shown[index - 1] ?? pageNumber - 1);
		if (1 === gap) {
			return [pageNumber];
		}
		return 2 === gap ? [pageNumber - 1, pageNumber] : [null, pageNumber];
	});
}
