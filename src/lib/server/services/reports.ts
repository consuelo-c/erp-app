// Reportes: read-only views over what the other modules recorded. Nothing here writes a row or an
// Event; each reader checks its roles and parses its filters like any other list.

import { z } from 'zod';
import { resolve } from '$app/paths';
import { addDays, getDayStartInstant } from '$lib/datetime';
import { requireRole, type Actor } from '../actor';
import { eventFieldsSchema } from '../audit';
import { optional } from './cash';

const MANAGERS = ['ADMIN', 'MANAGER'] as const;

/** Every `events.entity_type` the app writes: Auditoría's «Registro». */
export const EVENT_ENTITY_TYPES = [
	'ORDER',
	'QUOTE',
	'CONTACT',
	'PRODUCT',
	'USER',
	'EMPLOYEE',
	'TIMESHEET',
	'PAYROLL_RUN',
	'CASH_MOVEMENT',
	'CASH_HANDOVER',
	'RECEIVABLE',
	'INCIDENT',
	'INVENTORY_COUNT',
	'SETTINGS'
] as const;

export type EventEntityType = (typeof EVENT_ENTITY_TYPES)[number];

/** The `events.action` values Auditoría's «Acción» offers, each with a Spanish label. */
export const EVENT_ACTIONS = [
	'CREATED',
	'EDITED',
	'STATUS_CHANGED',
	'CANCELLED',
	'CONVERTED',
	'PAID',
	'REVERSED',
	'CLEARED',
	'INVENTORY_ADJUSTED',
	'RECEIVABLE_LINKED',
	'PASSWORD_SET',
	'LOGIN',
	'LOGIN_FAILED',
	'LOGOUT'
] as const;

export type EventAction = (typeof EVENT_ACTIONS)[number];

/** A page of Auditoría: it never loads the whole log. */
export const AUDIT_LOG_PAGE_SIZE = 20;

// Every filter optional and exact; an unreadable value is «all», a page past the last the last.
const auditLogSchema = z.object({
	from: optional(z.iso.date()),
	to: optional(z.iso.date()),
	username: optional(z.string().min(1)),
	entityType: optional(z.enum(EVENT_ENTITY_TYPES)),
	action: optional(z.enum(EVENT_ACTIONS)),
	page: z.coerce.number().int().min(1).catch(1)
});

export type AuditLogFilters = z.output<typeof auditLogSchema>;

type FieldValue = string | number | null;

/** One changed field, with its raw column name and stored values; null where it had none. */
export type FieldChange = { column: string; before: FieldValue; after: FieldValue };

export type RecordLink = { href: string; label: string };

export type AuditEvent = {
	id: number;
	createdAt: number;
	username: string;
	/** Raw: one of `EVENT_ENTITY_TYPES` in practice, shown raw when it has no label. */
	entityType: string;
	entityId: number | null;
	entityKey: string | null;
	action: string;
	changes: FieldChange[];
	reason: string | null;
	ip: string | null;
	userAgent: string | null;
	/** The record's page, or null when its type has none: «sin página». */
	link: RecordLink | null;
};

/** The filters come back parsed, `page` clamped: what the screen shows as chosen is what was applied. */
export type AuditLog = {
	events: AuditEvent[];
	total: number;
	pageCount: number;
	filters: AuditLogFilters;
	/** Every username in the log, sorted: deleted, renamed and mistyped ones too. */
	usernames: string[];
};

type Clause = { sql: string; params: (string | number)[] };

// Each Bogotá day runs from its midnight to the next one's, so `to` is inclusive.
function auditLogClauses({ from, to, username, entityType, action }: AuditLogFilters): Clause[] {
	const candidates: (Clause | null)[] = [
		from ? { sql: 'created_at >= ?', params: [getDayStartInstant(from)] } : null,
		to ? { sql: 'created_at < ?', params: [getDayStartInstant(addDays(to, 1))] } : null,
		username ? { sql: 'actor_username = ?', params: [username] } : null,
		entityType ? { sql: 'entity_type = ?', params: [entityType] } : null,
		action ? { sql: 'action = ?', params: [action] } : null
	];
	return candidates.filter((clause) => null !== clause);
}

// The record's readable name, read in the same query where it costs one lookup by primary key.
const RECORD_NAME_SQL = `case entity_type
	when 'CONTACT' then (select full_name from contacts where id = events.entity_id)
	when 'PRODUCT' then (select name from products where id = events.entity_id)
	when 'USER' then (select username from users where id = events.entity_id)
	when 'EMPLOYEE' then (select contacts.full_name from employees
		join contacts on contacts.id = employees.contact_id where employees.id = events.entity_id)
	end`;

// Only the types with a page of their own, each with what its label puts before the id; null
// labels it by the name read with it. A cash movement opens over the book, not on a page of its own.
const RECORD_PAGES = {
	ORDER: ['/(app)/pedidos/[id]', '#'],
	QUOTE: ['/(app)/cotizaciones/[id]', 'Cotización #'],
	RECEIVABLE: ['/(app)/cuentas-de-cobro/[id]', 'CC Nº '],
	CONTACT: ['/(app)/contactos/[id]', null],
	PRODUCT: ['/(app)/productos/[id]', null],
	USER: ['/(app)/logins/[id]', null],
	EMPLOYEE: ['/(app)/personal/[id]', null],
	INVENTORY_COUNT: ['/(app)/inventario/revisar/[id]', '']
} as const;

function hasRecordPage(type: string): type is keyof typeof RECORD_PAGES {
	return type in RECORD_PAGES;
}

// A record whose row is gone, or whose name can't be read, still links under its plain id.
function linkOf(row: EventRow): RecordLink | null {
	if (!hasRecordPage(row.entity_type) || null === row.entity_id) {
		return null;
	}
	const [routeId, prefix] = RECORD_PAGES[row.entity_type];
	const id = String(row.entity_id);
	const label = null === prefix ? (row.record_name ?? id) : `${prefix}${id}`;
	return { href: resolve(routeId, { id }), label };
}

function parseFields(json: string | null): Record<string, FieldValue> {
	return null === json ? {} : eventFieldsSchema.parse(JSON.parse(json));
}

/** Each field either side names, in the order it was written; a side without it held null. */
function diffEvent(beforeJson: string | null, afterJson: string | null): FieldChange[] {
	const before = parseFields(beforeJson);
	const after = parseFields(afterJson);
	const columns = [...new Set([...Object.keys(after), ...Object.keys(before)])];
	return columns.map((column) => ({
		column,
		before: before[column] ?? null,
		after: after[column] ?? null
	}));
}

type EventRow = {
	id: number;
	created_at: number;
	actor_username: string;
	entity_type: string;
	entity_id: number | null;
	entity_key: string | null;
	action: string;
	before: string | null;
	after: string | null;
	reason: string | null;
	ip: string | null;
	user_agent: string | null;
	record_name: string | null;
};

function toAuditEvent(row: EventRow): AuditEvent {
	return {
		id: row.id,
		createdAt: row.created_at,
		username: row.actor_username,
		entityType: row.entity_type,
		entityId: row.entity_id,
		entityKey: row.entity_key,
		action: row.action,
		changes: diffEvent(row.before, row.after),
		reason: row.reason,
		ip: row.ip,
		userAgent: row.user_agent,
		link: linkOf(row)
	};
}

async function countEvents(db: D1Database, where: string, params: Clause['params']) {
	const count = await db
		.prepare(`select count(*) as total from events where ${where}`)
		.bind(...params)
		.first<{ total: number }>();
	return count?.total ?? 0;
}

// Off the `actor_username` index alone, whatever the filters.
async function listUsernames(db: D1Database): Promise<string[]> {
	const { results } = await db
		.prepare('select distinct actor_username as username from events order by actor_username')
		.all<{ username: string }>();
	return results.map(({ username }) => username);
}

/** Auditoría: one page of the Event log, newest first, narrowed by every filter at once. */
export async function getAuditLog(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<AuditLog> {
	requireRole(actor, MANAGERS);
	const parsed = auditLogSchema.parse(input ?? {});
	const clauses = auditLogClauses(parsed);
	const where = clauses.map((clause) => `(${clause.sql})`).join(' and ') || '1';
	const params = clauses.flatMap((clause) => clause.params);
	const [total, usernames] = await Promise.all([countEvents(db, where, params), listUsernames(db)]);
	const pageCount = Math.max(1, Math.ceil(total / AUDIT_LOG_PAGE_SIZE));
	const filters = { ...parsed, page: Math.min(parsed.page, pageCount) };
	const { results } = await db
		.prepare(
			`select id, created_at, actor_username, entity_type, entity_id, entity_key, action, before,
			after, reason, ip, user_agent, ${RECORD_NAME_SQL} as record_name
			from events where ${where} order by created_at desc, id desc limit ? offset ?`
		)
		.bind(...params, AUDIT_LOG_PAGE_SIZE, (filters.page - 1) * AUDIT_LOG_PAGE_SIZE)
		.all<EventRow>();
	return {
		events: results.map(toAuditEvent),
		total,
		pageCount,
		filters,
		usernames
	};
}
