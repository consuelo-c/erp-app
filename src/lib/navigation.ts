import type { ComponentProps } from 'svelte';
import { resolve } from '$app/paths';
import type Icon from '$lib/components/Icon.svelte';
import { POLICIES, type Policy, type Role } from '$lib/roles';

type IconName = ComponentProps<typeof Icon>['name'];

/**
 * A page of the menu tree, with the policy its route lets in; without `policy`, every login. A
 * login holding any role of `hiddenFrom` doesn't see it, whatever else it holds.
 */
type MenuPage = {
	label: string;
	href: string;
	policy?: Policy;
	hiddenFrom?: Policy;
};

/**
 * A parent of the menu tree: Pagos and Reportes have no page of their own. The own page's `label`,
 * when it has one, is how it lists among the parent's pages; without it, it lists under the parent's.
 */
type MenuParent = {
	label: string;
	icon: IconName;
	page?: Omit<MenuPage, 'label'> & { label?: string };
	children: MenuPage[];
};

/** A parent as one login sees it: `href` is its own page, or else its first child it can open. */
export type MenuEntry = {
	label: string;
	icon: IconName;
	href: string;
	ownHref?: string;
	ownLabel?: string;
	children: MenuPageLink[];
};

type MenuPageLink = { label: string; href: string };

/** The menu tree, in its order. */
const MENU: MenuParent[] = [
	{ label: 'Despachos', icon: 'truck', page: { href: resolve('/despachos') }, children: [] },
	{
		label: 'Pedidos',
		icon: 'file',
		page: { href: resolve('/pedidos'), policy: 'orders' },
		children: [{ label: 'Cotizaciones', href: resolve('/cotizaciones'), policy: 'quotes' }]
	},
	{
		label: 'Productos/Inventario',
		icon: 'package',
		page: { label: 'Productos', href: resolve('/productos'), policy: 'products' },
		children: [
			{ label: 'Nuevo conteo', href: resolve('/inventario'), policy: 'inventoryCount' },
			{ label: 'Confirmar conteo', href: resolve('/inventario/revisar'), policy: 'inventoryReview' }
		]
	},
	{
		label: 'Contactos',
		icon: 'contact',
		page: { href: resolve('/contactos'), policy: 'contacts' },
		children: []
	},
	{
		label: 'Pagos/Efectivo',
		icon: 'wallet',
		children: [
			{ label: 'Cuentas de cobro', href: resolve('/cuentas-de-cobro'), policy: 'receivables' },
			{ label: 'Movimiento', href: resolve('/caja/registrar'), policy: 'managesCash' },
			{ label: 'Entregas de efectivo', href: resolve('/caja/entregas'), policy: 'managesCash' }
		]
	},
	// The managers are the drawer: they hold no cash for the company.
	{
		label: 'Efectivo por entregar',
		icon: 'wallet',
		page: { href: resolve('/efectivo'), policy: 'takesCash', hiddenFrom: 'managesCash' },
		children: []
	},
	{
		label: 'Nómina',
		icon: 'users',
		page: { label: 'Personal', href: resolve('/personal'), policy: 'employees' },
		children: [
			{ label: 'Nómina', href: resolve('/nomina'), policy: 'payroll' },
			{ label: 'Horas', href: resolve('/horas') },
			{ label: 'Logins', href: resolve('/logins'), policy: 'logins' }
		]
	},
	{
		label: 'Reportes',
		icon: 'chart',
		children: [
			{ label: 'Planilla horas', href: resolve('/horas/equipo'), policy: 'everyonesHours' },
			{ label: 'Movimientos caja', href: resolve('/caja'), policy: 'reports' },
			{
				label: 'Pérdidas y ganancias',
				href: resolve('/reportes/perdidas-y-ganancias'),
				policy: 'reports'
			},
			{
				label: 'Subalquiler',
				href: resolve('/reportes/subalquiler'),
				policy: 'subrental'
			},
			{ label: 'Auditoría', href: resolve('/reportes/auditoria'), policy: 'reports' }
		]
	},
	{
		label: 'Configuración',
		icon: 'settings',
		page: { href: resolve('/configuracion'), policy: 'settings' },
		children: [
			{ label: 'Nómina', href: resolve('/configuracion/nomina'), policy: 'settings' },
			{ label: 'Festivos', href: resolve('/configuracion/festivos'), policy: 'settings' },
			{ label: 'Ayuda', href: resolve('/configuracion/ayuda'), policy: 'settings' },
			{ label: 'Términos', href: resolve('/configuracion/terminos'), policy: 'settings' },
			{ label: 'Etiquetas', href: resolve('/configuracion/etiquetas'), policy: 'settings' }
		]
	},
	{ label: 'Ayuda', icon: 'help', page: { href: resolve('/ayuda') }, children: [] }
];

function canOpen(page: Pick<MenuPage, 'policy' | 'hiddenFrom'>, roles: readonly Role[]): boolean {
	const holdsAny = (policy: Policy) => POLICIES[policy].some((role) => roles.includes(role));
	const isLetIn = undefined === page.policy || holdsAny(page.policy);
	const isHidden = undefined !== page.hiddenFrom && holdsAny(page.hiddenFrom);
	return isLetIn && !isHidden;
}

/** A parent's own page as one login sees it: both keys undefined when it has none it can open. */
function getOwnPage(page: MenuParent['page'], roles: readonly Role[]) {
	const isOpen = undefined !== page && canOpen(page, roles);
	return { ownHref: isOpen ? page.href : undefined, ownLabel: isOpen ? page.label : undefined };
}

/** The menu one login sees: only what its roles open, and no parent left with nothing to open. */
export function getMenu(roles: readonly Role[]): MenuEntry[] {
	return MENU.flatMap(({ label, icon, page, children }) => {
		const own = getOwnPage(page, roles);
		const openChildren = children
			.filter((child) => canOpen(child, roles))
			.map((child) => ({ label: child.label, href: child.href }));
		const href = own.ownHref ?? openChildren[0]?.href;
		if (undefined === href) {
			return [];
		}
		return [{ label, icon, href, ...own, children: openChildren }];
	});
}

/** Every page a parent lists, in order: its own page under its own label or the parent's, then its children. */
export function getParentPages({ label, ownHref, ownLabel, children }: MenuEntry): MenuPageLink[] {
	return undefined === ownHref
		? children
		: [{ label: ownLabel ?? label, href: ownHref }, ...children];
}

/** The page among `pages` that holds the path: the most specific, so Planilla horas beats Horas. */
function findPageOf<Page extends { href: string }>(pages: Page[], pathname: string) {
	return pages
		.filter(({ href }) => pathname === href || pathname.startsWith(`${href}/`))
		.sort((first, second) => second.href.length - first.href.length)[0];
}

/** The href of the login's menu page that holds the path. */
export function findCurrentHref(menu: MenuEntry[], pathname: string): string | undefined {
	return findPageOf(menu.flatMap(getParentPages), pathname)?.href;
}

/** The menu label of the page that holds the path, whatever the login: the no-permission title. */
export function findPageLabel(pathname: string): string | undefined {
	const pages = MENU.flatMap(({ label, page, children }) =>
		page ? [{ label: page.label ?? label, href: page.href }, ...children] : children
	);
	return findPageOf(pages, pathname)?.label;
}

/** A parent the «Más» sheet slides into: one with more than one page the login can open. */
export function hasSheetList(parent: MenuEntry): boolean {
	return 1 < getParentPages(parent).length;
}

/** The parent whose list the «Más» sheet opens on: the one holding the current page, if it has a list. */
export function findSheetParent(menu: MenuEntry[], currentHref: string | undefined) {
	return menu.find(
		(parent) =>
			hasSheetList(parent) && getParentPages(parent).some(({ href }) => href === currentHref)
	);
}

export type BarSlot = { label: string; icon: IconName; href: string };

/** The bottom bar before «Más»: each slot is the first of its choices the login can open. */
const BAR: BarSlot[][] = [
	[{ label: 'Despachos', icon: 'truck', href: resolve('/despachos') }],
	[{ label: 'Horas', icon: 'clock', href: resolve('/horas') }]
];

/** The login's bar slots; a slot it can open none of is left out, and the bar is shorter. */
export function getBarSlots(menu: MenuEntry[]): BarSlot[] {
	const hrefs = new Set(menu.flatMap(getParentPages).map(({ href }) => href));
	return BAR.flatMap((choices) => choices.filter(({ href }) => hrefs.has(href)).slice(0, 1));
}

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
