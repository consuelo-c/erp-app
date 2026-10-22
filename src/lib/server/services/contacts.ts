// Contactos: the company's clients, providers and employees in one table, one phone each. Never
// deleted: orders and employees point to them.

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { normalizePhone } from '$lib/phone';
import { isAdminOrManager, requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate } from '../audit';
import { containing } from './cash';

// Whoever takes orders adds the clients.
const EDITS_CONTACTS = ['ADMIN', 'MANAGER', 'SALES'] as const;

/** What a provider does; empty means the contact isn't one. A new kind of provider is a code change. */
export const SERVICES = ['TRANSPORTER', 'DECORATOR', 'CHEF'] as const;

export type Service = (typeof SERVICES)[number];

export const servicesSchema = z
	.array(z.enum(SERVICES))
	.refine((services) => new Set(services).size === services.length, 'Un servicio no se repite');

const optionalText = z.string().min(1).optional();

// SQLite validates nothing: the JSON is checked on write and on read. A new key is a code change.
export const contactAttributesSchema = z.strictObject({
	email: optionalText,
	address_1: optionalText,
	address_2: optionalText,
	bank_account: optionalText,
	notes: optionalText
});

type Attributes = z.infer<typeof contactAttributesSchema>;

export type Contact = {
	id: number;
	phone: string;
	fullName: string;
	documentId: string | null;
	services: Service[];
	email: string | null;
	address1: string | null;
	address2: string | null;
	bankAccount: string | null;
	notes: string | null;
};

export type SaveResult =
	| { ok: true; id: number }
	| {
			ok: false;
			message: string;
			errors: Record<string, string>;
			/** The contact that already has the phone, for the screen to open it. */
			phoneOwner?: { id: number; fullName: string };
	  };

type Columns = {
	phone: string;
	full_name: string;
	document_id: string | null;
	services: string;
	attributes: string;
};

type ContactRow = Columns & { id: number; is_employee: number };

const INVALID_PHONE =
	'Número no válido. Un número de Colombia tiene 10 dígitos; uno de otro país empieza con +.';

function requiredText(message: string) {
	return z.string(message).trim().min(1, message);
}

// Optional: left blank, the key isn't stored.
const blankable = z
	.string()
	.trim()
	.optional()
	.transform((value) => value || undefined);

/** The typed phone, stored normalized; the employee form takes it the same way. */
export const phoneSchema = requiredText('Escribe el teléfono').transform((typed, context) => {
	const phone = normalizePhone(typed);
	if (null === phone) {
		context.addIssue({ code: 'custom', message: INVALID_PHONE });
		return z.NEVER;
	}
	return phone;
});

/** Spaces, dots and hyphens are how it's typed: «1.036.452.118» and «1036452118» are one document. */
export const documentIdSchema = z
	.string()
	.optional()
	.transform((value) => value?.replace(/[\s.-]/g, '').toUpperCase() || null);

const formSchema = z.object({
	phone: phoneSchema,
	full_name: requiredText('Escribe el nombre'),
	document_id: documentIdSchema,
	email: blankable.pipe(z.email('Revisa el correo: le falta la @ o el dominio').optional()),
	address_1: blankable,
	address_2: blankable,
	bank_account: blankable,
	notes: blankable,
	services: servicesSchema.default([])
});

const updateSchema = formSchema.extend({ id: z.coerce.number().int().positive() });

type Form = z.output<typeof formSchema>;

// Both in a fixed order, so an edit that changes nothing produces the same text and logs nothing.
function servicesJson(services: Service[]): string {
	return JSON.stringify(SERVICES.filter((service) => services.includes(service)));
}

function attributesJson(attributes: Attributes): string {
	const { email, address_1, address_2, bank_account, notes } =
		contactAttributesSchema.parse(attributes);
	return JSON.stringify({ email, address_1, address_2, bank_account, notes });
}

function toColumns(form: Form): Columns {
	const { phone, full_name, document_id, services, ...attributes } = form;
	return {
		phone,
		full_name,
		document_id,
		services: servicesJson(services),
		attributes: attributesJson(attributes)
	};
}

function toContact(row: ContactRow): Contact {
	const attributes = contactAttributesSchema.parse(JSON.parse(row.attributes));
	return {
		id: row.id,
		phone: row.phone,
		fullName: row.full_name,
		documentId: row.document_id,
		services: servicesSchema.parse(JSON.parse(row.services)),
		email: attributes.email ?? null,
		address1: attributes.address_1 ?? null,
		address2: attributes.address_2 ?? null,
		bankAccount: attributes.bank_account ?? null,
		notes: attributes.notes ?? null
	};
}

const NEW_CONTACT: Columns = {
	phone: '',
	full_name: '',
	document_id: null,
	services: '[]',
	attributes: '{}'
};

function bankAccountOf(columns: Columns): string | null {
	return contactAttributesSchema.parse(JSON.parse(columns.attributes)).bank_account ?? null;
}

function isOverwritten(current: string | null, next: string | null): boolean {
	return null !== current && current !== next;
}

// Redirected money: whoever pays copies the saved account without checking it, so changing one
// that's set is the manager's, and so is the ID number that goes with a refund, and a provider's
// services. Sales fills in what's still empty, except an employee's ID number: payroll's.
function changesLockedField(current: Columns, next: Columns, isEmployee: boolean): boolean {
	const documentChanged = isEmployee
		? current.document_id !== next.document_id
		: isOverwritten(current.document_id, next.document_id);
	return (
		current.services !== next.services ||
		documentChanged ||
		isOverwritten(bankAccountOf(current), bankAccountOf(next))
	);
}

// The screen shows these fields locked to Sales; a save that changes them anyway was forged.
function requireLockedFieldsKept(
	actor: Actor,
	{ current, next, isEmployee }: { current: Columns; next: Columns; isEmployee: boolean }
): void {
	if (!isAdminOrManager(actor) && changesLockedField(current, next, isEmployee)) {
		error(403, 'Solo Gerente o Administrador cambian ese dato');
	}
}

/** Each field's first message, for the form to show under it. */
export function invalidForm(zodError: z.ZodError): SaveResult {
	const errors = Object.fromEntries(
		zodError.issues.map((issue) => [String(issue.path[0]), issue.message])
	);
	return { ok: false, message: 'Revisa los campos marcados en rojo antes de guardar.', errors };
}

type Owner = { id: number; full_name: string };

// The UNIQUE columns still guard a race; this turns the common case into a message, not a 500.
async function findOwner(
	db: D1Database,
	{ column, value, exceptId }: { column: 'phone' | 'document_id'; value: string; exceptId: number }
): Promise<Owner | null> {
	return db
		.prepare(`select id, full_name from contacts where ${column} = ? and id != ?`)
		.bind(value, exceptId)
		.first<Owner>();
}

/** Why a phone or document number can't be saved on contact `exceptId`: another contact has it. */
export async function takenRefusal(
	db: D1Database,
	columns: Pick<Columns, 'phone' | 'document_id'>,
	exceptId: number
): Promise<SaveResult | null> {
	const phoneOwner = await findOwner(db, { column: 'phone', value: columns.phone, exceptId });
	if (null !== phoneOwner) {
		const message = `Ese teléfono ya es de ${phoneOwner.full_name}`;
		return {
			ok: false,
			message,
			errors: { phone: message },
			phoneOwner: { id: phoneOwner.id, fullName: phoneOwner.full_name }
		};
	}
	if (null === columns.document_id) {
		return null;
	}
	const documentOwner = await findOwner(db, {
		column: 'document_id',
		value: columns.document_id,
		exceptId
	});
	if (null === documentOwner) {
		return null;
	}
	const message = `Esa cédula o NIT ya es de ${documentOwner.full_name}`;
	return { ok: false, message, errors: { document_id: message } };
}

async function findRow(db: D1Database, id: number): Promise<ContactRow | null> {
	return db
		.prepare(
			`select id, phone, full_name, document_id, services, attributes,
			exists (select 1 from employees where contact_id = contacts.id) as is_employee
			from contacts where id = ?`
		)
		.bind(id)
		.first<ContactRow>();
}

export async function getContact(
	db: D1Database,
	id: number,
	actor: Actor | null
): Promise<Contact | null> {
	requireRole(actor, EDITS_CONTACTS);
	const row = await findRow(db, id);
	return null === row ? null : toContact(row);
}

export async function createContact(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, EDITS_CONTACTS);
	const parsed = formSchema.safeParse(input);
	if (!parsed.success) {
		return invalidForm(parsed.error);
	}
	const columns = toColumns(parsed.data);
	requireLockedFieldsKept(actor, { current: NEW_CONTACT, next: columns, isEmployee: false });
	const refusal = await takenRefusal(db, columns, 0);
	if (null !== refusal) {
		return refusal;
	}
	const statements = auditedInsert(db, {
		table: 'contacts',
		entityType: 'CONTACT',
		actor,
		values: columns
	});
	const [inserted] = await db.batch(statements);
	return { ok: true, id: inserted.meta.last_row_id };
}

// `attributes` is logged key by key: an account change reads as `attributes.bank_account`.
async function applyEdit(
	db: D1Database,
	actor: Actor,
	{ row, columns }: { row: ContactRow; columns: Columns }
): Promise<SaveResult> {
	const statements = auditedUpdate(db, {
		table: 'contacts',
		entityType: 'CONTACT',
		actor,
		id: row.id,
		current: row,
		changes: columns,
		jsonColumns: ['attributes']
	});
	if (0 < statements.length) {
		await db.batch(statements);
	}
	return { ok: true, id: row.id };
}

const NOT_FOUND: SaveResult = { ok: false, message: 'Ese contacto no existe', errors: {} };

// Payroll prints it on every receipt: an employee's contact always has one.
const EMPLOYEE_DOCUMENT_MESSAGE = 'Es empleado: la cédula no puede quedar vacía';
const EMPLOYEE_DOCUMENT_REQUIRED: SaveResult = {
	ok: false,
	message: EMPLOYEE_DOCUMENT_MESSAGE,
	errors: { document_id: EMPLOYEE_DOCUMENT_MESSAGE }
};

/** The whole form: a locked field Sales can't change still arrives, with its current value. */
export async function updateContact(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<SaveResult> {
	requireRole(actor, EDITS_CONTACTS);
	const parsed = updateSchema.safeParse(input);
	if (!parsed.success) {
		return invalidForm(parsed.error);
	}
	const { id, ...form } = parsed.data;
	const row = await findRow(db, id);
	if (null === row) {
		return NOT_FOUND;
	}
	const columns = toColumns(form);
	const isEmployee = 1 === row.is_employee;
	requireLockedFieldsKept(actor, { current: row, next: columns, isEmployee });
	const refusal =
		isEmployee && null === columns.document_id
			? EMPLOYEE_DOCUMENT_REQUIRED
			: await takenRefusal(db, columns, id);
	if (null !== refusal) {
		return refusal;
	}
	return applyEdit(db, actor, { row, columns });
}

/** «Cargar más» brings this many at a time; the list never loads the whole table. */
export const CONTACTS_PAGE_SIZE = 10;

// Filters come from the URL: an empty or tampered value is ignored, not an error.
const listSchema = z.object({
	search: z.string().trim().catch(''),
	service: z.enum(SERVICES).optional().catch(undefined),
	offset: z.coerce.number().int().nonnegative().catch(0)
});

export type ContactSummary = { id: number; fullName: string; phone: string; services: Service[] };

export type ContactPage = { contacts: ContactSummary[]; hasMore: boolean };

type Clause = { sql: string; params: string[] };

// Letters search the name. Otherwise the digits typed, three or more, anywhere in the phone, so
// «442 8890» finds 573104428890: not the normalizer, a fragment isn't a phone.
function searchClause(search: string): Clause | null {
	if (/\p{L}/u.test(search)) {
		return { sql: "full_name like ? escape '\\'", params: [containing(search)] };
	}
	const digits = search.replace(/\D/g, '');
	return 3 <= digits.length ? { sql: 'phone like ?', params: [`%${digits}%`] } : null;
}

// In SQL: this table holds every client, so it can reach thousands of rows.
function serviceClause(service: Service | undefined): Clause | null {
	if (undefined === service) {
		return null;
	}
	return {
		sql: 'exists (select 1 from json_each(contacts.services) where value = ?)',
		params: [service]
	};
}

type SummaryRow = { id: number; full_name: string; phone: string; services: string };

/** A page of contacts sorted by name, narrowed by name or phone and by service. */
export async function listContacts(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<ContactPage> {
	requireRole(actor, EDITS_CONTACTS);
	const { search, service, offset } = listSchema.parse(input ?? {});
	const clauses = [searchClause(search), serviceClause(service)].filter(
		(clause) => null !== clause
	);
	const where = clauses.map((clause) => `(${clause.sql})`).join(' and ') || '1';
	// ponytail: nocase folds ASCII only, so «Ángela» sorts after Z; a sort key column if it bothers.
	// One row past the page says whether «Cargar más» has more to bring.
	const { results } = await db
		.prepare(
			`select id, full_name, phone, services from contacts where ${where}
			order by full_name collate nocase, id limit ? offset ?`
		)
		.bind(...clauses.flatMap((clause) => clause.params), CONTACTS_PAGE_SIZE + 1, offset)
		.all<SummaryRow>();
	const contacts = results.slice(0, CONTACTS_PAGE_SIZE).map((row) => ({
		id: row.id,
		fullName: row.full_name,
		phone: row.phone,
		services: servicesSchema.parse(JSON.parse(row.services))
	}));
	return { contacts, hasMore: CONTACTS_PAGE_SIZE < results.length };
}
