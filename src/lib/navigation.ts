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
	{ label: 'Pedidos', icon: 'list' },
	{
		label: 'Contactos',
		icon: 'contact',
		href: resolve('/contactos'),
		paths: [resolve('/contactos')]
	},
	{ label: 'Inventario', icon: 'package' },
	{
		label: 'Caja',
		icon: 'wallet',
		href: resolve('/caja'),
		paths: [resolve('/caja')]
	},
	{
		label: 'Personal y Nómina',
		icon: 'users',
		href: resolve('/personal'),
		paths: [resolve('/personal'), resolve('/nomina')]
	},
	{
		label: 'Sistema',
		icon: 'settings',
		href: resolve('/configuracion'),
		paths: [resolve('/configuracion'), resolve('/logins')]
	}
];

/** How many destinations fit the bottom bar before «Más». */
export const BAR_SLOTS = 3;

/** Not a destination: it lives in «Más» and at the sidebar's foot. */
export const HELP: Destination = { label: 'Ayuda', icon: 'help' };

/** Personal y Nómina's tabs: the employees and their weekly settlement. */
export const PERSONAL_TABS = [
	{ label: 'Personal', href: resolve('/personal') },
	{ label: 'Nómina', href: resolve('/nomina') }
];

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

/** Caja's tabs: the book and the entry of a movement no other module records. */
export const CASH_TABS = [
	{ label: 'Libro de caja', href: resolve('/caja') },
	{ label: 'Registrar movimiento', shortLabel: 'Registrar', href: resolve('/caja/registrar') }
];

/** Sistema's tabs: the system settings, the holidays editor and, for `ADMIN`, the logins. */
export const SETTINGS_TABS = [
	{ label: 'Configuración', href: resolve('/configuracion') },
	{ label: 'Festivos', href: resolve('/configuracion/festivos') }
];
export const ADMIN_SETTINGS_TABS = [
	...SETTINGS_TABS,
	{ label: 'Logins', href: resolve('/logins') }
];
