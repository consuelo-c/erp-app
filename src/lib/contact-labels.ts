// A contact's etiquetas: the list the manager keeps in `CONTACTS_LABELS`, each contact holding the
// keys of the ones it carries. The code finds one only by key, never by name, so a rename breaks
// nothing.

import { z } from 'zod';

/** The carrier picker's etiqueta. Built in: it can be renamed, never deleted. */
export const TRANSPORTER = 'TRANSPORTER';

/** A client not to serve on credit, or at all. Built in: it can be renamed, never deleted. */
export const BANNED = 'BANNED';

/** The Contactos filter's value for the contacts an employee points to; no etiqueta takes it. */
export const EMPLOYEE_FILTER = 'EMPLOYEE';

export type ContactLabel = { key: string; name: string };

const collator = new Intl.Collator('es', { sensitivity: 'base' });

const isSortedByName = (labels: ContactLabel[]) =>
	labels.every((label, i) => 0 === i || collator.compare(labels[i - 1].name, label.name) <= 0);

const hasDuplicates = (values: string[]) => new Set(values).size !== values.length;

export const contactLabelsSchema = z
	.array(z.strictObject({ key: z.string().min(1), name: z.string().trim().min(1) }))
	.refine((labels) => !hasDuplicates(labels.map(({ key }) => key)), 'Keys must be unique')
	.refine(
		(labels) => !hasDuplicates(labels.map(({ name }) => name.toLocaleLowerCase('es'))),
		'Ya existe una etiqueta con ese nombre'
	)
	.refine(isSortedByName, 'Labels must be sorted by name')
	.refine(
		(labels) => [TRANSPORTER, BANNED].every((key) => labels.some((label) => key === label.key)),
		'TRANSPORTER and BANNED are built in'
	)
	.refine((labels) => labels.every(({ key }) => EMPLOYEE_FILTER !== key), 'EMPLOYEE is taken');

/** A contact's `labels`: keys, none repeated. Whether each exists is checked against the setting. */
export const labelKeysSchema = z
	.array(z.string().min(1))
	.refine((keys) => !hasDuplicates(keys), 'Una etiqueta no se repite');

/** The names of `keys`, A–Z, as the setting sorts them. */
export function labelNames(keys: string[], labels: ContactLabel[]): string[] {
	return labels.filter(({ key }) => keys.includes(key)).map(({ name }) => name);
}

export type ContactBadge = { text: string; tone?: 'error' | 'info' };

const MAX_BADGES = 3;

/** A Contactos row's badges: Vetado, Empleado, then the etiquetas A–Z; past three, a count. */
export function contactBadges(
	contact: { labels: string[]; isEmployee: boolean },
	labels: ContactLabel[]
): { badges: ContactBadge[]; more: number } {
	const named = labels.filter(({ key }) => contact.labels.includes(key));
	const banned = named.filter(({ key }) => BANNED === key);
	const all: ContactBadge[] = [
		...banned.map(({ name }) => ({ text: name, tone: 'error' as const })),
		...(contact.isEmployee ? [{ text: 'Empleado', tone: 'info' as const }] : []),
		...named.filter(({ key }) => BANNED !== key).map(({ name }) => ({ text: name }))
	];
	return { badges: all.slice(0, MAX_BADGES), more: Math.max(0, all.length - MAX_BADGES) };
}

/** What Contactos says when nothing matches: the search and the etiqueta, named. */
export function noMatchText(search: string, filter: ContactLabel | undefined): string {
	if (EMPLOYEE_FILTER === filter?.key) {
		return '' === search
			? 'Aún no hay ningún empleado.'
			: `Nadie coincide con «${search}» entre los empleados.`;
	}
	if (undefined === filter) {
		return `Nadie coincide con «${search}».`;
	}
	return '' === search
		? `Ningún contacto tiene la etiqueta ${filter.name}.`
		: `Nadie coincide con «${search}» con la etiqueta ${filter.name}.`;
}
