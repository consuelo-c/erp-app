// System settings: every `settings` key but PAYROLL_HOLIDAYS, which has its own editor. One current
// value per key; each changed key is an `EDITED` event carrying the key in `entity_key`.

import { z } from 'zod';
import { dialTimeShape, toClockTime } from '$lib/datetime';
import { getSettingInput, SETTINGS, type SettingKey } from '$lib/settings';
import { requireRole, type Actor } from '../actor';
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
