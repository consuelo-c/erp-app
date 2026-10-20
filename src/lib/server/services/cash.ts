// Caja: every peso in or out. Movements are never edited or deleted: a mistake is offset by
// another movement with the same concept and link, the opposite sign and `reverses_id`.

import { z } from 'zod';
import type { Actor } from '../actor';
import { auditedInsert } from '../audit';

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
