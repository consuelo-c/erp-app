// The lists' shared helpers: URL filters, typed search text, LIKE patterns and paging.

import { z } from 'zod';

/** A filter from the URL: an empty or tampered value is ignored, not an error. */
export function optional<T extends z.ZodType>(schema: T) {
	return z
		.preprocess((value) => ('' === value || null === value ? undefined : value), schema.optional())
		.catch(undefined);
}

// The text as typed, its runs of spaces collapsed: «ivan     betancur» is two words.
export const searchTextSchema = z
	.string()
	.transform((typed) => typed.trim().replace(/\s+/g, ' '))
	.pipe(z.string().min(1));

// A LIKE pattern for typed text: its own % and _ match themselves.
export function containing(text: string): string {
	return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
}

// SQLite's lower() only knows ASCII, so the accented letters and tildes are swapped first, to match
// what `fold` makes of the typed text. ponytail: these seven letters and their capitals only; a
// stored folded name if names with other accents (ç, à) turn up.
const FOLDED_LETTERS = [
	'áa',
	'ée',
	'íi',
	'óo',
	'úu',
	'üu',
	'ñn',
	'ÁA',
	'ÉE',
	'ÍI',
	'ÓO',
	'ÚU',
	'ÜU',
	'ÑN'
];

/** A text column as `fold` would leave it, for a LIKE against folded words. */
export function foldedSql(column: string): string {
	return `lower(${FOLDED_LETTERS.reduce(
		(sql, [letter, plain]) => `replace(${sql}, '${letter}', '${plain}')`,
		column
	)})`;
}

/**
 * The page a list shows: never fewer than one page, a page past the last is the last, and the
 * offset of its first row.
 */
export function paginate(
	total: number,
	page: number,
	pageSize: number
): { page: number; pageCount: number; offset: number } {
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const clamped = Math.min(page, pageCount);
	return { page: clamped, pageCount, offset: (clamped - 1) * pageSize };
}
