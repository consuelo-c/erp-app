// System settings, and PAYROLL_HOLIDAYS through its own editor. One current value per key; each
// changed key is an `EDITED` event carrying the key in `entity_key`.

import { z } from 'zod';
import { dialTimeShape, formatLongDay, toClockTime } from '$lib/datetime';
import { getExtraHoursRange } from '$lib/payroll';
import { getSettingInput, holidaysSchema, SETTINGS, type SettingKey } from '$lib/settings';
import { isAdmin, requireRole, type Actor } from '../actor';
import { auditedUpdate } from '../audit';

// A mistake here throws off all of payroll: only the ones who settle it edit settings.
const EDITS_SETTINGS = ['ADMIN', 'MANAGER'] as const;

export type SystemSettingKey = Exclude<SettingKey, 'PAYROLL_HOLIDAYS'>;

const SYSTEM_SETTING_KEYS = (Object.keys(SETTINGS) as SettingKey[]).filter(
	(key): key is SystemSettingKey => 'PAYROLL_HOLIDAYS' !== key
);

/** Each key's stored text. */
export type SystemSettings = Record<SystemSettingKey, string>;

export type SaveResult =
	{ ok: true } | { ok: false; errors: Partial<Record<SystemSettingKey, string>> };

// Every form field arrives as text.
const formSchema = z.record(z.string(), z.string());

type ParsedField = { value: string } | { message: string };

export async function getSystemSettings(db: D1Database, actor: Actor | null) {
	requireRole(actor, EDITS_SETTINGS);
	return findSystemSettings(db);
}

/**
 * Validates every field with its key's schema and saves the ones that changed, with their events,
 * in one batch. Any invalid field saves nothing and comes back with its message.
 */
export async function updateSystemSettings(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, EDITS_SETTINGS);
	const form = formSchema.parse(input);
	const fields = SYSTEM_SETTING_KEYS.map((key) => ({ key, parsed: parseField(key, form) }));
	const errors = collectErrors(fields);
	if (Object.keys(errors).length > 0) {
		return { ok: false, errors };
	}
	const current = await findSystemSettings(db);
	const statements = fields.flatMap(({ key, parsed }) =>
		auditedUpdate(db, {
			table: 'settings',
			entityType: 'SETTINGS',
			actor,
			idColumn: 'key',
			id: key,
			current: { value: current[key] },
			changes: { value: 'value' in parsed ? parsed.value : current[key] }
		})
	);
	if (statements.length > 0) {
		await db.batch(statements);
	}
	return { ok: true };
}

function collectErrors(fields: { key: SystemSettingKey; parsed: ParsedField }[]) {
	return Object.fromEntries(
		fields.flatMap(({ key, parsed }) => ('message' in parsed ? [[key, parsed.message]] : []))
	);
}

async function findSystemSettings(db: D1Database): Promise<SystemSettings> {
	const { results } = await db
		.prepare(
			`select key, value from settings where key in (${SYSTEM_SETTING_KEYS.map(() => '?').join(', ')})`
		)
		.bind(...SYSTEM_SETTING_KEYS)
		.all<{ key: string; value: string }>();
	const values = Object.fromEntries(results.map(({ key, value }) => [key, value]));
	const missing = SYSTEM_SETTING_KEYS.find((key) => undefined === values[key]);
	if (undefined !== missing) {
		throw new Error(`Setting ${missing} is missing: run the settings seed`);
	}
	// In SETTINGS' order, the screen's: the query returns them sorted by key.
	return Object.fromEntries(SYSTEM_SETTING_KEYS.map((key) => [key, values[key]])) as SystemSettings;
}

type SettingValue<K extends SettingKey> = z.output<(typeof SETTINGS)[K]['schema']>;
export type SettingValues<K extends SettingKey> = { [Key in K]: SettingValue<Key> };

/** The parsed values of `keys`, for the services that calculate with them; the caller checks the role. */
export async function readSettings<K extends SettingKey>(
	db: D1Database,
	keys: readonly K[]
): Promise<SettingValues<K>> {
	const { results } = await db
		.prepare(`select key, value from settings where key in (${keys.map(() => '?').join(', ')})`)
		.bind(...keys)
		.all<{ key: string; value: string }>();
	const stored = Object.fromEntries(results.map(({ key, value }) => [key, value]));
	return Object.fromEntries(
		keys.map((key) => [key, SETTINGS[key].schema.parse(stored[key])])
	) as SettingValues<K>;
}

// The field as typed, turned into the text its key stores, then checked with the key's schema.
function parseField(key: SystemSettingKey, form: Record<string, string>): ParsedField {
	const typed = readTypedValue(key, form);
	if ('message' in typed) {
		return typed;
	}
	const result = SETTINGS[key].schema.safeParse(typed.value);
	return result.success
		? { value: String(result.data) }
		: { message: result.error.issues[0].message };
}

function readTypedValue(key: SystemSettingKey, form: Record<string, string>): ParsedField {
	const input = getSettingInput(key);
	if ('clock' === input) {
		return readClockTime(key, form);
	}
	const typed = form[key] ?? '';
	// Thousands separators are how people type pesos (1.750.905); only the digits are stored.
	return { value: 'number' === input ? typed.replace(/\D/g, '') : typed };
}

function readClockTime(key: SystemSettingKey, form: Record<string, string>): ParsedField {
	const result = z.object(dialTimeShape).safeParse({
		hour: form[`${key}.hour`],
		minute: form[`${key}.minute`],
		period: form[`${key}.period`]
	});
	return result.success
		? { value: toClockTime(result.data) }
		: { message: result.error.issues[0].message };
}

export type Holiday = z.output<typeof holidaysSchema>[number];

export type HolidaysEditor = {
	holidays: Holiday[];
	// The last day a PAID settlement paid extra hours for, or null with none paid yet.
	freezeLine: string | null;
	canOverrideFreeze: boolean;
};

export type HolidaysResult = { ok: true } | { ok: false; message: string };

const holidayShape = {
	date: z.iso.date('Escoge la fecha del festivo'),
	label: z.string().trim().min(1, 'Escribe el nombre del festivo')
};

// The editor posts the dates after the freeze line as one JSON field; the closed ones stay as stored.
const openHolidaysSchema = z.object({
	holidays: z
		.string()
		.transform((value, context) => {
			try {
				return JSON.parse(value) as unknown;
			} catch {
				context.addIssue({ code: 'custom', message: 'Revisa la lista de festivos' });
				return z.NEVER;
			}
		})
		.pipe(z.array(z.object(holidayShape)))
});

const overrideSchema = z.object({
	original: z.iso.date(),
	...holidayShape,
	remove: z.literal('true').optional(),
	reason: z.string().trim().min(1, 'Escribe el motivo del cambio')
});

export async function getHolidays(db: D1Database, actor: Actor | null): Promise<HolidaysEditor> {
	requireRole(actor, EDITS_SETTINGS);
	const [holidays, freezeLine] = await Promise.all([findHolidays(db), findFreezeLine(db)]);
	return { holidays, freezeLine, canOverrideFreeze: isAdmin(actor) };
}

/**
 * Saves the holidays after the freeze line as posted; the ones on or before it are kept as stored,
 * for ADMIN too: changing one goes through `overrideFrozenHoliday`, with its reason.
 */
export async function updateHolidays(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<HolidaysResult> {
	requireRole(actor, EDITS_SETTINGS);
	const parsed = openHolidaysSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0].message };
	}
	const [current, freezeLine] = await Promise.all([findHolidays(db), findFreezeLine(db)]);
	const closed = parsed.data.holidays.find((holiday) => isFrozen(holiday.date, freezeLine));
	if (undefined !== closed) {
		return { ok: false, message: `${frozenMessage(closed)}: no se puede agregar ni cambiar` };
	}
	const kept = current.filter((holiday) => isFrozen(holiday.date, freezeLine));
	return saveHolidays(db, { current, holidays: [...kept, ...parsed.data.holidays], actor });
}

/**
 * ADMIN's change to one holiday on or before the freeze line: a new date or name or, with `remove`,
 * its removal (the popup posts the date and name either way).
 * The required reason lands on the write's `events` row, never inside the holiday itself.
 */
export async function overrideFrozenHoliday(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<HolidaysResult> {
	requireRole(actor, ['ADMIN']);
	const parsed = overrideSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0].message };
	}
	const { original, reason } = parsed.data;
	const [current, freezeLine] = await Promise.all([findHolidays(db), findFreezeLine(db)]);
	if (!current.some((holiday) => original === holiday.date && isFrozen(holiday.date, freezeLine))) {
		return { ok: false, message: 'Esa fecha no está en una nómina pagada' };
	}
	const others = current.filter((holiday) => original !== holiday.date);
	const holidays = parsed.data.remove ? others : [...others, toHoliday(parsed.data)];
	return saveHolidays(db, { current, holidays, actor, reason });
}

function toHoliday({ date, label }: Holiday): Holiday {
	return { date, label };
}

function isFrozen(date: string, freezeLine: string | null): boolean {
	return null !== freezeLine && date <= freezeLine;
}

function frozenMessage(holiday: Holiday): string {
	return `El ${formatLongDay(holiday.date).toLowerCase()} está en una nómina pagada`;
}

type HolidaysWrite = { current: Holiday[]; holidays: Holiday[]; actor: Actor; reason?: string };

// Sorted here, so the key's schema only has duplicates left to reject.
async function saveHolidays(db: D1Database, write: HolidaysWrite): Promise<HolidaysResult> {
	const sorted = [...write.holidays].sort((first, second) => first.date.localeCompare(second.date));
	if (!holidaysSchema.safeParse(sorted).success) {
		return { ok: false, message: 'Esa fecha ya está en la lista' };
	}
	const statements = auditedUpdate(db, {
		table: 'settings',
		entityType: 'SETTINGS',
		actor: write.actor,
		idColumn: 'key',
		id: 'PAYROLL_HOLIDAYS',
		current: { value: JSON.stringify(write.current) },
		changes: { value: JSON.stringify(sorted) },
		reason: write.reason
	});
	if (statements.length > 0) {
		await db.batch(statements);
	}
	return { ok: true };
}

async function findHolidays(db: D1Database): Promise<Holiday[]> {
	return (await readSettings(db, ['PAYROLL_HOLIDAYS'])).PAYROLL_HOLIDAYS;
}

// Extra-hours ranges move with period_start, so the latest PAID one ends on the freeze line.
async function findFreezeLine(db: D1Database): Promise<string | null> {
	const row = await db
		.prepare(`select max(period_start) as periodStart from payroll_runs where status = 'PAID'`)
		.first<{ periodStart: string | null }>();
	return row?.periodStart ? getExtraHoursRange(row.periodStart).end : null;
}
