// Entregas de efectivo and each person's Efectivo por entregar: the cash a driver or Sales rep
// holds for the company. A handover isn't a cash movement: it moves the company's own cash from a
// pocket to the drawer, so it takes no receipt number and never touches Caja.

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getTodaysDate } from '$lib/datetime';
import { hasAnyRole, requireRole, rolesSchema, type Actor, type Role } from '../actor';
import { optional, type CashConcept, type PaymentMethod } from './cash';

// Whose tab a movement is on: whoever recorded it, or, for an offset (only the manager records
// one), whoever recorded the movement it offsets, so correcting a mistake corrects their tab.
const HOLDER = `coalesce((select original.created_by from cash_movements as original
	where original.id = cash_movements.reverses_id), cash_movements.created_by)`;

// The drawer: their cash is already the company's, so they have no tab.
const MANAGES_CASH = ['ADMIN', 'MANAGER'] as const;

// The roles that take cash for the company: the warehouse never does.
const TAKES_CASH = ['SALES', 'DRIVER'] as const;

/** Whether a login has an Efectivo por entregar: it takes cash and isn't the drawer. */
function hasTab(roles: readonly Role[]): boolean {
	const holds = (role: Role) => roles.includes(role);
	return TAKES_CASH.some(holds) && !MANAGES_CASH.some(holds);
}

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
};

/** The movements of one order, or of one cuenta de cobro, newest first. */
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

type Range = { username: string; from: string; to: string };

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
};

async function listGroups(
	db: D1Database,
	{ username, from, to }: Range
): Promise<StatementGroup[]> {
	const { results } = await db
		.prepare(
			`select id, concept, payment_method, amount, movement_date, receipt_number, entity_type, entity_id
			from cash_movements
			where ${HOLDER} = ? and movement_date between ? and ?
			order by movement_date desc, id desc`
		)
		.bind(username, from, to)
		.all<MovementRow>();
	return groupByEntity(results);
}

function groupByEntity(rows: MovementRow[]): StatementGroup[] {
	const groups = new Map<string, StatementGroup>();
	for (const row of rows) {
		const key = `${row.entity_type}:${row.entity_id}`;
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
			isCounted: 'CASH' === row.payment_method
		});
		groups.set(key, group);
	}
	return [...groups.values()];
}

async function listHandovers(db: D1Database, { username, from, to }: Range): Promise<Handover[]> {
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
	return hasAnyRole(actor, MANAGES_CASH) || actor.username === username;
}

type Login = { username: string; name: string; roles: Role[]; isActive: boolean };

const SELECT_LOGIN = `select users.username, users.roles, users.active,
		coalesce(contacts.full_name, users.username) as name
	from users
	left join employees on employees.id = users.employee_id
	left join contacts on contacts.id = employees.contact_id`;

type LoginRow = { username: string; roles: string; active: number; name: string };

function toLogin(row: LoginRow): Login {
	return {
		username: row.username,
		name: row.name,
		roles: rolesSchema.parse(JSON.parse(row.roles)),
		isActive: 1 === row.active
	};
}

async function findLogin(db: D1Database, username: string): Promise<Login | null> {
	const row = await db
		.prepare(`${SELECT_LOGIN} where users.username = ?`)
		.bind(username)
		.first<LoginRow>();
	return null === row ? null : toLogin(row);
}

export type PersonWithTab = { username: string; name: string };

/**
 * The «Persona» choices: every login with a tab, by name. A deactivated one stays while they
 * still hold cash, so what they owe can still be handed in.
 */
export async function listPeopleWithTab(
	db: D1Database,
	actor: Actor | null
): Promise<PersonWithTab[]> {
	requireRole(actor, MANAGES_CASH);
	const { results } = await db.prepare(SELECT_LOGIN).all<LoginRow>();
	const logins = results.map(toLogin).filter(({ roles }) => hasTab(roles));
	const pending = await Promise.all(logins.map(({ username }) => sumPending(db, username)));
	return logins
		.filter(({ isActive }, index) => isActive || 0 !== pending[index])
		.map(({ username, name }) => ({ username, name }))
		.sort((first, second) => first.name.localeCompare(second.name, 'es'));
}

/** A person's tab: what they hold now, and their movements and handovers in the range. */
export async function getCashStatement(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<CashStatement> {
	requireRole(actor, [...MANAGES_CASH, ...TAKES_CASH]);
	const typed = statementInputSchema.parse(input);
	const today = getTodaysDate();
	const range = { username: typed.username, from: typed.from ?? today, to: typed.to ?? today };
	if (!canReadTab(actor, range.username)) {
		error(403, 'No tienes permiso para esta acción');
	}
	const login = await findLogin(db, range.username);
	if (null === login || !hasTab(login.roles)) {
		error(404, 'Esa persona no tiene efectivo por entregar');
	}
	const [pending, groups, handovers] = await Promise.all([
		sumPending(db, range.username),
		listGroups(db, range),
		listHandovers(db, range)
	]);
	return { pending, range: { from: range.from, to: range.to }, groups, handovers };
}
