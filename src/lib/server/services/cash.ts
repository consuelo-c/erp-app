// Caja: every peso in or out. Movements are never edited or deleted: a mistake is offset by
// another movement with the same concept and link, the opposite sign and `reverses_id`.

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getMonthRange, getTodaysDate } from '$lib/datetime';
import { parsePesos } from '$lib/payroll';
import { requireRole, type Actor } from '../actor';
import { auditedInsert } from '../audit';
import { COMPANY_SETTINGS, readSettings, type CompanySettings } from './settings';

// The cash book, its receipts and every movement recorded by hand.
const MANAGES_CASH = ['ADMIN', 'MANAGER'] as const;

// Whoever records an order's money in prints its receipt from the order.
const TAKES_ORDERS = ['ADMIN', 'MANAGER', 'SALES'] as const;

export const CASH_CONCEPTS = [
	'INSTALLMENT',
	'SECURITY_DEPOSIT',
	'INSTALLMENT_REFUND',
	'DEPOSIT_REFUND',
	'PAYROLL',
	'CARRIER_PAYMENT',
	'OTHER_INCOME',
	'OTHER_EXPENSE'
] as const;

export type CashConcept = (typeof CASH_CONCEPTS)[number];

/** The concepts whose money comes in: every other one goes out. An offset flips the sign. */
const INFLOW_CONCEPTS: readonly CashConcept[] = ['INSTALLMENT', 'SECURITY_DEPOSIT', 'OTHER_INCOME'];

export const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'OTHER'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// A standalone movement has no order or settlement to say what it was: its description does,
// printed as the receipt's «Concepto».
const STANDALONE_CONCEPTS: readonly CashConcept[] = ['OTHER_INCOME', 'OTHER_EXPENSE'];

// SQLite validates nothing: a movement's JSON is checked on write and on read.
export const movementAttributesSchema = z.object({
	description: z.string().min(1).optional(),
	bank_account: z.string().min(1).optional(),
	other_method: z.string().min(1).optional(),
	notes: z.string().min(1).optional()
});

export const movementSchema = z
	.object({
		concept: z.enum(CASH_CONCEPTS),
		payment_method: z.enum(PAYMENT_METHODS),
		amount: z.number().int(),
		movement_date: z.iso.date(),
		entity_type: z.string().nullable(),
		entity_id: z.number().int().nullable(),
		payee: z.string().min(1).nullable().default(null),
		reverses_id: z.number().int().nullable().default(null),
		attributes: movementAttributesSchema
	})
	.refine(
		({ concept, attributes }) =>
			!STANDALONE_CONCEPTS.includes(concept) || undefined !== attributes.description,
		{ message: 'Escribe la descripción', path: ['attributes', 'description'] }
	);

export type Movement = z.input<typeof movementSchema>;

// Recibo de caja (+) and comprobante de egreso (−) are numbered apart, each its sign's highest
// plus one, worked out by the INSERT itself: one statement is atomic in D1, so there's no
// transaction and no separate read. The unique index on (sign, receipt_number) is the backstop.
const NEXT_RECEIPT_NUMBER =
	'select coalesce(max(receipt_number), 0) + 1 from cash_movements where (amount > 0) = ?';

/**
 * The only way into `cash_movements`, for every module: the numbered insert and its `CREATED`
 * event, for the caller's `db.batch()`. The event must run right after the insert.
 */
export function movementStatements(
	db: D1Database,
	actor: Actor,
	movement: Movement
): D1PreparedStatement[] {
	const { attributes, ...columns } = movementSchema.parse(movement);
	const isInflow = Number(0 < columns.amount);
	return auditedInsert(db, {
		table: 'cash_movements',
		entityType: 'CASH_MOVEMENT',
		actor,
		values: { ...columns, attributes: JSON.stringify(attributes) },
		computed: { receipt_number: { sql: NEXT_RECEIPT_NUMBER, params: [isInflow] } }
	});
}

export const DIRECTIONS = ['IN', 'OUT'] as const;

export type RecordResult =
	{ ok: true; id: number } | { ok: false; message: string; errors: Record<string, string> };

const directionSchema = z.object({
	direction: z.enum(DIRECTIONS, 'Escoge si es una entrada o una salida')
});

function requiredText(message: string) {
	return z.string(message).trim().min(1, message);
}

const optionalText = z
	.string()
	.trim()
	.optional()
	.transform((value) => value || undefined);

// Typed positive, the sign comes from Tipo. The receipt writes it in words up to 999.999.999.
const AMOUNT_MESSAGE = 'Escribe un valor mayor que cero';
const amountSchema = z
	.string(AMOUNT_MESSAGE)
	.transform(parsePesos)
	.pipe(
		z
			.number()
			.int()
			.positive(AMOUNT_MESSAGE)
			.max(999_999_999, 'Escribe un valor de hasta $999.999.999')
	);

// What a standalone movement says about itself: no order or settlement says it for it.
function partyShape(isInflow: boolean) {
	return {
		description: requiredText('Escribe la descripción'),
		payee: requiredText(isInflow ? 'Escribe de quién se recibió' : 'Escribe a quién se le pagó')
	};
}

// The movement entry tab, every field as text; each form extends it.
const entryBase = z.object({
	payment_method: z.enum(PAYMENT_METHODS, 'Escoge el método'),
	other_method: optionalText,
	bank_account: optionalText,
	movement_date: z.iso.date('Escoge la fecha'),
	notes: optionalText
});

type EntryForm = z.infer<typeof entryBase>;

// «Otro» says which method; a transfer names where the money went: the bank an inflow came
// into, the account an outflow was paid to.
function checkMethod<T extends z.ZodType<EntryForm>>(isInflow: boolean, schema: T): T {
	return schema
		.refine((form) => 'OTHER' !== form.payment_method || undefined !== form.other_method, {
			path: ['other_method'],
			message: 'Escribe el medio de pago'
		})
		.refine((form) => !isTransfer(form) || undefined !== form.bank_account, {
			path: ['bank_account'],
			message: isInflow ? 'Escribe el banco' : 'Escribe la cuenta de destino'
		});
}

function isTransfer(form: { payment_method: PaymentMethod }): boolean {
	return 'TRANSFER' === form.payment_method;
}

// Only the keys the method uses: which one «Otro» was, and a transfer's bank or account.
function toAttributes(form: EntryForm & { description?: string }): Movement['attributes'] {
	return {
		description: form.description,
		other_method: 'OTHER' === form.payment_method ? form.other_method : undefined,
		bank_account: isTransfer(form) ? form.bank_account : undefined,
		notes: form.notes
	};
}

function invalid(error: z.ZodError): RecordResult {
	const errors = Object.fromEntries(
		error.issues.map((issue) => [String(issue.path[0]), issue.message])
	);
	return { ok: false, message: 'Revisa los campos marcados en rojo antes de guardar.', errors };
}

function refuse(message: string): RecordResult {
	return { ok: false, message, errors: {} };
}

async function insertMovement(
	db: D1Database,
	actor: Actor,
	movement: Movement
): Promise<RecordResult> {
	const [inserted] = await db.batch(movementStatements(db, actor, movement));
	return { ok: true, id: inserted.meta.last_row_id };
}

/**
 * Records a movement no other module does: «Entrada» is an `OTHER_INCOME`, «Salida» an
 * `OTHER_EXPENSE`. Returns the new movement's id, for its detail.
 */
export async function recordMovement(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<RecordResult> {
	requireRole(actor, MANAGES_CASH);
	const direction = directionSchema.safeParse(input);
	if (!direction.success) {
		return invalid(direction.error);
	}
	const isInflow = 'IN' === direction.data.direction;
	const schema = entryBase.extend({ ...partyShape(isInflow), amount: amountSchema });
	const form = checkMethod(isInflow, schema).safeParse(input);
	if (!form.success) {
		return invalid(form.error);
	}
	return insertMovement(db, actor, {
		concept: isInflow ? 'OTHER_INCOME' : 'OTHER_EXPENSE',
		payment_method: form.data.payment_method,
		amount: isInflow ? form.data.amount : -form.data.amount,
		movement_date: form.data.movement_date,
		entity_type: null,
		entity_id: null,
		payee: form.data.payee,
		attributes: toAttributes(form.data)
	});
}

/** A movement another module links: its concept, its link and who it's with come from the caller. */
export type LinkedMovement = {
	/** Method, amount, date and notes, as the entry form posts them. */
	form: unknown;
	concept: CashConcept;
	entityType: string;
	entityId: number;
	payee: string;
};

/** Records a linked movement as typed: Valor positive, the sign from the concept. */
export async function recordLinkedMovement(
	db: D1Database,
	movement: LinkedMovement,
	actor: Actor
): Promise<RecordResult> {
	const isInflow = INFLOW_CONCEPTS.includes(movement.concept);
	const schema = checkMethod(isInflow, entryBase.extend({ amount: amountSchema }));
	const form = schema.safeParse(movement.form);
	if (!form.success) {
		return invalid(form.error);
	}
	return insertMovement(db, actor, {
		concept: movement.concept,
		payment_method: form.data.payment_method,
		amount: isInflow ? form.data.amount : -form.data.amount,
		movement_date: form.data.movement_date,
		entity_type: movement.entityType,
		entity_id: movement.entityId,
		payee: movement.payee,
		attributes: toAttributes(form.data)
	});
}

/** Why a movement can't be offset, or null when it can: once, and never a correction itself. */
function offsetRefusal(movement: { isOffset: boolean; isCorrected: boolean }): string | null {
	if (movement.isOffset) {
		return 'Un movimiento contrario no se corrige: si el error fue la corrección, registra de nuevo el original.';
	}
	if (movement.isCorrected) {
		return 'Ese movimiento ya tiene su movimiento contrario.';
	}
	return null;
}

/** The movement `?corrige=` names, to pre-fill its offsetting movement: one that can be offset. */
export async function getOffsetOriginal(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<MovementDetail> {
	const original = await getMovement(db, input, actor);
	if (null === original) {
		error(404, 'Ese movimiento no existe');
	}
	const refusal = offsetRefusal({
		isOffset: null !== original.reverses,
		isCorrected: null !== original.reversedBy
	});
	if (null !== refusal) {
		error(400, refusal);
	}
	return original;
}

type OriginalRow = {
	id: number;
	concept: CashConcept;
	amount: number;
	entity_type: string | null;
	entity_id: number | null;
	payee: string | null;
	reverses_id: number | null;
	corrected_by: number | null;
};

async function findOriginal(db: D1Database, input: unknown): Promise<OriginalRow | null> {
	const id = z.coerce.number().int().positive().safeParse(input);
	if (!id.success) {
		return null;
	}
	return db
		.prepare(
			`select id, concept, amount, entity_type, entity_id, payee, reverses_id,
				(select correction.id from cash_movements as correction where correction.reverses_id = cash_movements.id) as corrected_by
			from cash_movements where id = ?`
		)
		.bind(id.data)
		.first<OriginalRow>();
}

// A standalone movement's correction says again what it was and who it was with; a linked one
// keeps its order's or settlement's.
function offsetSchema(isInflow: boolean, original: OriginalRow) {
	const isStandalone = null === original.entity_type;
	return checkMethod(isInflow, entryBase.extend(isStandalone ? partyShape(isInflow) : {}));
}

/**
 * Records the offsetting movement of `reverses_id`: its concept and link, the opposite amount, and
 * `reverses_id` pointing to it. The rest is the manager's, as in the entry tab. A movement is offset
 * once, a correction never; a PAYROLL one's settlement stays PAID, as it was.
 */
export async function recordOffset(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<RecordResult> {
	requireRole(actor, MANAGES_CASH);
	const original = await findOriginal(db, (input as { reverses_id?: unknown })?.reverses_id);
	if (null === original) {
		return refuse('Ese movimiento no existe.');
	}
	const refusal = offsetRefusal({
		isOffset: null !== original.reverses_id,
		isCorrected: null !== original.corrected_by
	});
	if (null !== refusal) {
		return refuse(refusal);
	}
	const isInflow = original.amount < 0;
	const form = offsetSchema(isInflow, original).safeParse(input);
	if (!form.success) {
		return invalid(form.error);
	}
	// ponytail: two corrections racing past the check: the UNIQUE on reverses_id rejects the second as a 500.
	return insertMovement(db, actor, toOffset(original, form.data));
}

function toOffset(
	original: OriginalRow,
	form: EntryForm & { description?: string; payee?: string }
): Movement {
	return {
		concept: original.concept,
		payment_method: form.payment_method,
		amount: -original.amount,
		movement_date: form.movement_date,
		entity_type: original.entity_type,
		entity_id: original.entity_id,
		payee: form.payee ?? original.payee,
		reverses_id: original.id,
		attributes: toAttributes(form)
	};
}

/** A filter from the URL: an empty or tampered value is ignored, not an error. */
export function optional<T extends z.ZodType>(schema: T) {
	return z
		.preprocess((value) => ('' === value || null === value ? undefined : value), schema.optional())
		.catch(undefined);
}

/** Pesos as people type them, $45.000: only the digits count. */
export const typedPesosSchema = z
	.string()
	.transform((value) => value.replace(/\D/g, ''))
	.pipe(z.string().min(1))
	.transform(Number);

const cashBookFiltersSchema = z.object({
	from: optional(z.iso.date()),
	to: optional(z.iso.date()),
	concept: optional(z.enum(CASH_CONCEPTS)),
	method: optional(z.enum(PAYMENT_METHODS)),
	direction: optional(z.enum(DIRECTIONS)),
	employee: optional(z.string().trim().min(1)),
	order: optional(typedPesosSchema), // the order number, typed as #1043
	min: optional(typedPesosSchema),
	max: optional(typedPesosSchema),
	text: optional(z.string().trim().min(1))
});

/** What the cash book is narrowed by; the period always has both ends, this month by default. */
export type CashBookFilters = z.infer<typeof cashBookFiltersSchema> & { from: string; to: string };

export type CashBookEntry = {
	id: number;
	movementDate: string;
	concept: CashConcept;
	amount: number;
	method: PaymentMethod;
	/** The link: the order it belongs to, the payroll week a PAYROLL movement pays and to whom,
	 * or a standalone one's payee. */
	orderId: number | null;
	weekNumber: number | null;
	employeeName: string | null;
	payee: string | null;
	description: string | null;
	recordedBy: string;
	/** When it was recorded, epoch seconds: the book shows its time under the date. */
	recordedAt: number;
	receiptNumber: number;
};

/** The filtered period's money in and out, as positive pesos, and their difference. */
export type CashBookTotals = { inflow: number; outflow: number; net: number };

type Clause = { sql: string; params: (string | number)[] };

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

// Free text over who was paid or paid us, the description and the notes.
function textClause(pattern: string): Clause {
	const columns = [
		'cash_movements.payee',
		"json_extract(cash_movements.attributes, '$.description')",
		"json_extract(cash_movements.attributes, '$.notes')"
	];
	return {
		sql: columns.map((column) => `${column} like ? escape '\\'`).join(' or '),
		params: columns.map(() => pattern)
	};
}

// The movements paying an employee whose name contains the text: a subquery, not a join.
function employeeClause(pattern: string): Clause {
	return {
		sql: `cash_movements.entity_type = 'PAYROLL_RUN' and cash_movements.entity_id in (
			select payroll_runs.id from payroll_runs join employees on employees.id = payroll_runs.employee_id
			join contacts on contacts.id = employees.contact_id
			where contacts.full_name like ? escape '\\')`,
		params: [pattern]
	};
}

// One clause per filter, each narrowing on its own. No joins: the totals stay one SUM over the table.
const CLAUSES: ((filters: CashBookFilters) => Clause | null)[] = [
	({ from, to }) => ({ sql: 'cash_movements.movement_date between ? and ?', params: [from, to] }),
	({ concept }) => (concept ? { sql: 'cash_movements.concept = ?', params: [concept] } : null),
	({ method }) => (method ? { sql: 'cash_movements.payment_method = ?', params: [method] } : null),
	({ direction }) => {
		if (undefined === direction) {
			return null;
		}
		return { sql: `cash_movements.amount ${'IN' === direction ? '>' : '<'} 0`, params: [] };
	},
	({ employee }) => (employee ? employeeClause(containing(employee)) : null),
	({ order }) =>
		undefined === order
			? null
			: {
					sql: "cash_movements.entity_type = 'ORDER' and cash_movements.entity_id = ?",
					params: [order]
				},
	({ min }) =>
		undefined === min ? null : { sql: 'abs(cash_movements.amount) >= ?', params: [min] },
	({ max }) =>
		undefined === max ? null : { sql: 'abs(cash_movements.amount) <= ?', params: [max] },
	({ text }) => (text ? textClause(containing(text)) : null)
];

function whereClause(filters: CashBookFilters): Clause {
	const clauses = CLAUSES.map((clause) => clause(filters)).filter((clause) => null !== clause);
	return {
		sql: clauses.map((clause) => `(${clause.sql})`).join(' and '),
		params: clauses.flatMap((clause) => clause.params)
	};
}

type EntryRow = {
	id: number;
	movement_date: string;
	concept: CashConcept;
	amount: number;
	payment_method: PaymentMethod;
	payee: string | null;
	entity_type: string | null;
	entity_id: number | null;
	attributes: string;
	receipt_number: number;
	created_by: string;
	created_at: number;
	week_number: number | null;
	full_name: string | null;
};

function toEntry(row: EntryRow): CashBookEntry {
	return {
		id: row.id,
		movementDate: row.movement_date,
		concept: row.concept,
		amount: row.amount,
		method: row.payment_method,
		orderId: 'ORDER' === row.entity_type ? row.entity_id : null,
		weekNumber: row.week_number,
		employeeName: row.full_name,
		payee: row.payee,
		description: movementAttributesSchema.parse(JSON.parse(row.attributes)).description ?? null,
		recordedBy: row.created_by,
		recordedAt: row.created_at,
		receiptNumber: row.receipt_number
	};
}

async function listEntries(db: D1Database, where: Clause): Promise<CashBookEntry[]> {
	const { results } = await db
		.prepare(
			`select cash_movements.id, cash_movements.movement_date, cash_movements.concept, cash_movements.amount,
				cash_movements.payment_method, cash_movements.payee, cash_movements.entity_type,
				cash_movements.entity_id, cash_movements.attributes,
				cash_movements.receipt_number, cash_movements.created_by, cash_movements.created_at,
				payroll_runs.week_number, contacts.full_name
			from cash_movements
			left join payroll_runs on cash_movements.entity_type = 'PAYROLL_RUN' and payroll_runs.id = cash_movements.entity_id
			left join employees on employees.id = payroll_runs.employee_id
			left join contacts on contacts.id = employees.contact_id
			where ${where.sql}
			order by cash_movements.movement_date desc, cash_movements.id desc`
		)
		.bind(...where.params)
		.all<EntryRow>();
	return results.map(toEntry);
}

// The period's net, not a cash balance: it mixes cash with transfers. One SUM, no join.
async function sumTotals(db: D1Database, where: Clause): Promise<CashBookTotals> {
	const totals = await db
		.prepare(
			`select coalesce(sum(max(amount, 0)), 0) as inflow, coalesce(-sum(min(amount, 0)), 0) as outflow,
				coalesce(sum(amount), 0) as net
			from cash_movements where ${where.sql}`
		)
		.bind(...where.params)
		.first<CashBookTotals>();
	return totals!;
}

/** A movement's receipt, as another movement's detail names it: its sign picks the title. */
export type ReceiptReference = { amount: number; receiptNumber: number };

/**
 * What the movement's receipt prints, plus who recorded it and when, and its correction. Its
 * `employeeName` is the one the settlement's snapshot keeps, as the receipt prints it.
 */
export type MovementDetail = CashBookEntry & {
	otherMethod: string | null;
	bankAccount: string | null;
	notes: string | null;
	/** The movement this one offsets, and the one that offsets it: at most one of the two is set. */
	reverses: ReceiptReference | null;
	reversedBy: ReceiptReference | null;
	/** The settlement a PAYROLL movement pays, as Nómina opens it: its employee and week. */
	settlement: { employeeId: number; periodStart: string } | null;
};

type DetailRow = Omit<EntryRow, 'full_name'> & {
	employee_snapshot: string | null;
	employee_id: number | null;
	period_start: string | null;
	original_amount: number | null;
	original_receipt_number: number | null;
	correction_amount: number | null;
	correction_receipt_number: number | null;
};

// Only the name is read off payroll's `employee_snapshot`; payroll validates the rest.
const snapshotNameSchema = z.object({ full_name: z.string() });

function toReference(amount: number | null, receiptNumber: number | null): ReceiptReference | null {
	return null === amount || null === receiptNumber ? null : { amount, receiptNumber };
}

function toDetail(row: DetailRow): MovementDetail {
	const attributes = movementAttributesSchema.parse(JSON.parse(row.attributes));
	const snapshot = row.employee_snapshot ? JSON.parse(row.employee_snapshot) : null;
	return {
		...toEntry({ ...row, full_name: null }),
		employeeName: snapshot ? snapshotNameSchema.parse(snapshot).full_name : null,
		otherMethod: attributes.other_method ?? null,
		bankAccount: attributes.bank_account ?? null,
		notes: attributes.notes ?? null,
		reverses: toReference(row.original_amount, row.original_receipt_number),
		reversedBy: toReference(row.correction_amount, row.correction_receipt_number),
		settlement:
			null === row.employee_id || null === row.period_start
				? null
				: { employeeId: row.employee_id, periodStart: row.period_start }
	};
}

/** One movement's detail, or null when there's no such movement: a tampered id included. */
export async function getMovement(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<MovementDetail | null> {
	requireRole(actor, MANAGES_CASH);
	return findDetail(db, input);
}

async function findDetail(db: D1Database, input: unknown): Promise<MovementDetail | null> {
	const id = z.coerce.number().int().positive().safeParse(input);
	if (!id.success) {
		return null;
	}
	const row = await db
		.prepare(
			`select cash_movements.*, payroll_runs.week_number, payroll_runs.employee_snapshot,
				payroll_runs.employee_id, payroll_runs.period_start,
				original.amount as original_amount, original.receipt_number as original_receipt_number,
				correction.amount as correction_amount, correction.receipt_number as correction_receipt_number
			from cash_movements
			left join payroll_runs on cash_movements.entity_type = 'PAYROLL_RUN' and payroll_runs.id = cash_movements.entity_id
			left join cash_movements as original on original.id = cash_movements.reverses_id
			left join cash_movements as correction on correction.reverses_id = cash_movements.id
			where cash_movements.id = ?`
		)
		.bind(id.data)
		.first<DetailRow>();
	return null === row ? null : toDetail(row);
}

/**
 * A movement's printed receipt: its detail and the company's header. Sales prints an order
 * movement's from the order; the rest of Caja stays the manager's.
 */
export async function getReceipt(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<{ movement: MovementDetail; company: CompanySettings }> {
	requireRole(actor, TAKES_ORDERS);
	const [movement, company] = await Promise.all([
		findDetail(db, input),
		readSettings(db, COMPANY_SETTINGS)
	]);
	if (null === movement) {
		error(404, 'Ese movimiento no existe');
	}
	if (null === movement.orderId) {
		requireRole(actor, MANAGES_CASH);
	}
	return { movement, company };
}

/** Every movement the filters let through, newest first, and the period's three totals. */
export async function getCashBook(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<{ filters: CashBookFilters; entries: CashBookEntry[]; totals: CashBookTotals }> {
	requireRole(actor, MANAGES_CASH);
	const month = getMonthRange(getTodaysDate());
	const parsed = cashBookFiltersSchema.parse(input ?? {});
	const filters = { ...parsed, from: parsed.from ?? month.start, to: parsed.to ?? month.end };
	const where = whereClause(filters);
	const [entries, totals] = await Promise.all([listEntries(db, where), sumTotals(db, where)]);
	return { filters, entries, totals };
}
