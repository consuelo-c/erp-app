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
	{ label: 'Inventario', icon: 'package' },
	{
		label: 'Nómina',
		icon: 'banknote',
		href: resolve('/nomina'),
		paths: [resolve('/nomina')]
	},
	{
		label: 'Personal',
		icon: 'users',
		href: resolve('/personal'),
		paths: [resolve('/personal'), resolve('/logins')]
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
export const HELP: Destination = { label: 'Ayuda', icon: 'help' };

/** Personal's tabs, for the logins that manage logins. */
export const PERSONAL_TABS = [
	{ label: 'Personal', href: resolve('/personal') },
	{ label: 'Logins', href: resolve('/logins') }
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

/** Configuración's tabs: the system settings and the holidays editor. */
export const SETTINGS_TABS = [
	{ label: 'Configuración', href: resolve('/configuracion') },
	{ label: 'Festivos', href: resolve('/configuracion/festivos') }
];
