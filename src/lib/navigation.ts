import type { ComponentProps } from 'svelte';
import { resolve } from '$app/paths';
import type Icon from '$lib/components/Icon.svelte';

type IconName = ComponentProps<typeof Icon>['name'];

/** A menu destination. No `href` until the phase that builds its screens: shown, but disabled. */
export type Destination = {
	label: string;
	icon: IconName;
	href?: string;
	/** Paths under this destination, its own included: which entry is current. */
	paths?: string[];
};

// The same menu for every login: a section outside the login's roles is its route's 403.
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

/** Configuración's tabs: the general and payroll settings, and the holidays and help editors. */
export const SETTINGS_TABS = [
	{ label: 'General', href: resolve('/configuracion') },
	{ label: 'Nómina', href: resolve('/configuracion/nomina') },
	{ label: 'Festivos', href: resolve('/configuracion/festivos') },
	{ label: 'Ayuda', href: resolve('/configuracion/ayuda') }
];

/** Productos, or with a group one group's variants; `query` adds the rest, like `guardado`. */
export function catalogHref(group: string | null, query: Record<string, string> = {}): string {
	const search = String(new URLSearchParams(null === group ? query : { grupo: group, ...query }));
	const productsHref = resolve('/productos');
	return '' === search ? productsHref : `${productsHref}?${search}`;
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
