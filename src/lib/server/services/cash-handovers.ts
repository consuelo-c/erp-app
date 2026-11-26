// Entregas de efectivo and each person's Efectivo por entregar: the cash a driver or Sales rep
// holds for the company. A handover isn't a cash movement: it moves the company's own cash from a
// pocket to the drawer, so it takes no receipt number and never touches Caja.

import { z } from 'zod';
import { getTodaysDate } from '$lib/datetime';
import { parsePesos } from '$lib/payroll';
import { POLICIES } from '$lib/roles';
import { hasAnyRole, hasCashTab, requireRole, type Actor } from '../actor';
import { auditedInsert } from '../audit';
import { invalid, type SaveResult } from '../result';
import { movementAttributesSchema, optional, type CashConcept, type PaymentMethod } from './cash';
import { SELECT_LOGIN, toLogin, type Login, type LoginRow } from './logins';

// Whose tab a movement is on, the one rule every reader of Efectivo por entregar shares. An
// expense the manager records «Pagado por» someone is on that person's tab; anything else is on
// whoever recorded it. An offset (only the manager records one) follows the movement it offsets,
// so correcting a mistake corrects the same tab.
const HOLDER = `coalesce(
	(select json_extract(original.attributes, '$.paid_by') from cash_movements as original
		where original.id = cash_movements.reverses_id),
	json_extract(cash_movements.attributes, '$.paid_by'),
	(select original.created_by from cash_movements as original
		where original.id = cash_movements.reverses_id),
	cash_movements.created_by)`;

// The range comes from the URL: missing or unreadable, an end is today.
const statementInputSchema = z.object({
	username: z.string().min(1),
	from: optional(z.iso.date()),
	to: optional(z.iso.date())
});

export type StatementMovement = {
	id: number;
	concept: CashConcept;
	paymentMethod: PaymentMethod;
	amount: number;
	movementDate: string;
	receiptNumber: number;
	/** Only cash counts: a transfer is in the bank. */
	isCounted: boolean;
	/** What a movement with no order or cuenta de cobro was for. */
	description: string | null;
	recordedBy: string;
};

/**
 * The movements of one order, or of one cuenta de cobro, newest first. A movement with neither (an
 * expense paid out of the tab) is a group of its own, with its offset.
 */
export type StatementGroup = {
	orderId: number | null;
	receivableId: number | null;
	movements: StatementMovement[];
};

export type Handover = {
	id: number;
	amount: number;
	handoverDate: string;
	note: string | null;
	recordedBy: string;
};

export type CashStatement = {
	/** All-time, whatever the range. */
	pending: number;
	range: { from: string; to: string };
	groups: StatementGroup[];
	handovers: Handover[];
};

/** Whose tab, and the dates its movements and handovers are read between. */
type StatementQuery = { username: string; from: string; to: string };

async function sumPending(db: D1Database, username: string): Promise<number> {
	const row = await db
		.prepare(
			`select (select coalesce(sum(amount), 0) from cash_movements
					where ${HOLDER} = ?1 and payment_method = 'CASH')
				- (select coalesce(sum(cash_handovers.amount), 0) from cash_handovers
					join users on users.id = cash_handovers.user_id where users.username = ?1) as pending`
		)
		.bind(username)
		.first<{ pending: number }>();
	return row!.pending;
}

type MovementRow = {
	id: number;
	concept: CashConcept;
	payment_method: PaymentMethod;
	amount: number;
	movement_date: string;
	receipt_number: number;
	entity_type: string | null;
	entity_id: number | null;
	reverses_id: number | null;
	attributes: string;
	created_by: string;
};

async function listGroups(
	db: D1Database,
	{ username, from, to }: StatementQuery
): Promise<StatementGroup[]> {
	const { results } = await db
		.prepare(
			`select id, concept, payment_method, amount, movement_date, receipt_number, entity_type,
				entity_id, reverses_id, attributes, created_by
			from cash_movements
			where ${HOLDER} = ? and movement_date between ? and ?
			order by movement_date desc, id desc`
		)
		.bind(username, from, to)
		.all<MovementRow>();
	return groupByEntity(results);
}

// An order's or a cuenta de cobro's movements share a group; a standalone one shares its offset's.
function groupKey(row: MovementRow): string {
	return null === row.entity_type
		? `movement:${row.reverses_id ?? row.id}`
		: `${row.entity_type}:${row.entity_id}`;
}

function groupByEntity(rows: MovementRow[]): StatementGroup[] {
	const groups = new Map<string, StatementGroup>();
	for (const row of rows) {
		const key = groupKey(row);
		const group = groups.get(key) ?? {
			orderId: 'ORDER' === row.entity_type ? row.entity_id : null,
			receivableId: 'RECEIVABLE' === row.entity_type ? row.entity_id : null,
			movements: []
		};
		group.movements.push({
			id: row.id,
			concept: row.concept,
			paymentMethod: row.payment_method,
			amount: row.amount,
			movementDate: row.movement_date,
			receiptNumber: row.receipt_number,
			isCounted: 'CASH' === row.payment_method,
			description: movementAttributesSchema.parse(JSON.parse(row.attributes)).description ?? null,
			recordedBy: row.created_by
		});
		groups.set(key, group);
	}
	return [...groups.values()];
}

async function listHandovers(
	db: D1Database,
	{ username, from, to }: StatementQuery
): Promise<Handover[]> {
	const { results } = await db
		.prepare(
			`select cash_handovers.id, cash_handovers.amount, cash_handovers.handover_date,
				cash_handovers.note, cash_handovers.created_by
			from cash_handovers join users on users.id = cash_handovers.user_id
			where users.username = ? and cash_handovers.handover_date between ? and ?
			order by cash_handovers.handover_date desc, cash_handovers.id desc`
		)
		.bind(username, from, to)
		.all<{
			id: number;
			amount: number;
			handover_date: string;
			note: string | null;
			created_by: string;
		}>();
	return results.map((row) => ({
		id: row.id,
		amount: row.amount,
		handoverDate: row.handover_date,
		note: row.note,
		recordedBy: row.created_by
	}));
}

/** A non-manager reads only their own tab. */
function canReadTab(actor: Actor, username: string): boolean {
	return hasAnyRole(actor, POLICIES.managesCash) || actor.username === username;
}

/** The login `username` names, when it has an Efectivo por entregar; null otherwise. */
async function findLoginWithTab(db: D1Database, username: string): Promise<Login | null> {
	const row = await db
		.prepare(`${SELECT_LOGIN} where users.username = ?`)
		.bind(username)
		.first<LoginRow>();
	const login = null === row ? null : toLogin(row);
	return null !== login && hasCashTab(login.roles) ? login : null;
}

export type PersonWithTab = { username: string; name: string; pending: number };

/**
 * The «Persona» choices: every login with a tab, by name, with what they hold now. A deactivated
 * one stays while they still hold cash, so what they owe can still be handed in.
 */
export async function listPeopleWithTab(
	db: D1Database,
	actor: Actor | null
): Promise<PersonWithTab[]> {
	requireRole(actor, POLICIES.managesCash);
	const { results } = await db.prepare(SELECT_LOGIN).all<LoginRow>();
	const logins = results.map(toLogin).filter(({ roles }) => hasCashTab(roles));
	const held = await Promise.all(logins.map(({ username }) => sumPending(db, username)));
	return logins
		.map((login, index) => ({ ...login, pending: held[index] }))
		.filter(({ isActive, pending }) => isActive || 0 !== pending)
		.map(({ username, employee, pending }) => ({
			username,
			name: employee?.fullName ?? username,
			pending
		}))
		.sort((first, second) => first.name.localeCompare(second.name, 'es'));
}

/**
 * A person's tab: what they hold now, and their movements and handovers in the range. Null when
 * they have none, or it isn't the actor's to read.
 */
export async function getCashStatement(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<CashStatement | null> {
	requireRole(actor, POLICIES.readsCashTab);
	const typed = statementInputSchema.parse(input);
	const today = getTodaysDate();
	const range = { username: typed.username, from: typed.from ?? today, to: typed.to ?? today };
	if (!canReadTab(actor, range.username) || null === (await findLoginWithTab(db, range.username))) {
		return null;
	}
	const [pending, groups, handovers] = await Promise.all([
		sumPending(db, range.username),
		listGroups(db, range),
		listHandovers(db, range)
	]);
	return { pending, range: { from: range.from, to: range.to }, groups, handovers };
}

const AMOUNT_MESSAGE = 'Escribe un valor mayor que cero';

// «Entregó», «Recibido», «Fecha» and «Nota (opcional)», every field as text.
const handoverSchema = z.object({
	username: z.string('Escoge quién entregó').trim().min(1, 'Escoge quién entregó'),
	amount: z
		.string(AMOUNT_MESSAGE)
		.transform(parsePesos)
		.pipe(z.number().int().positive(AMOUNT_MESSAGE)),
	handover_date: z.iso.date('Escoge la fecha'),
	note: z
		.string()
		.trim()
		.optional()
		.transform((value) => value || null)
});

/**
 * Records the cash a person handed in: their tab goes down by it. Only the drawer records one, and
 * whatever it falls short of stays on the tab: nothing else moves.
 */
export async function recordHandover(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult<{ id: number }>> {
	requireRole(actor, POLICIES.managesCash);
	const form = handoverSchema.safeParse(input);
	if (!form.success) {
		return invalid(form.error);
	}
	const login = await findLoginWithTab(db, form.data.username);
	if (null === login) {
		const message = 'Esa persona no tiene efectivo por entregar';
		return { ok: false, message, errors: { username: message } };
	}
	const [inserted] = await db.batch(
		auditedInsert(db, {
			table: 'cash_handovers',
			entityType: 'CASH_HANDOVER',
			actor,
			values: {
				user_id: login.id,
				amount: form.data.amount,
				handover_date: form.data.handover_date,
				note: form.data.note
			}
		})
	);
	return { ok: true, id: inserted.meta.last_row_id };
}
