// Contactos: the company's clients, providers and employees in one table, one document each; a phone
// may be shared. Never deleted: orders and employees point to them.

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { fold } from '$lib/format';
import { normalizePhone } from '$lib/phone';
import { isAdminOrManager, requireRole, type Actor } from '../actor';
import { auditedInsert, auditedUpdate } from '../audit';
import { containing, foldedSql } from './cash';

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
	/** A real one, or the automatic one when none was given: `@` and 8 characters. */
	documentId: string;
	services: Service[];
	email: string | null;
	address1: string | null;
	address2: string | null;
	bankAccount: string | null;
	notes: string | null;
	/** An employee points to it: its ID number is then never automatic. */
	isEmployee: boolean;
};

export type SaveResult =
	{ ok: true; id: number } | { ok: false; message: string; errors: Record<string, string> };

/** The columns as typed: `document_id` is null until the automatic one fills a blank. */
type Columns = {
	phone: string;
	full_name: string;
	document_id: string | null;
	services: string;
	attributes: string;
};

type ContactRow = Columns & { id: number; document_id: string; is_employee: number };

const CHECK_FIELDS = 'Revisa los campos marcados en rojo antes de guardar.';

export const INVALID_PHONE =
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

/** Marks a document the app made up because none was given; no real one starts with it. */
export const AUTO_DOCUMENT_PREFIX = '@';

export function isAutoDocument(documentId: string): boolean {
	return documentId.startsWith(AUTO_DOCUMENT_PREFIX);
}

// Crockford's base32: 32 symbols divide 256 evenly, and none reads as another (no I, L, O, U).
const AUTO_DOCUMENT_SYMBOLS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Most clients never give one, yet the document is the contact's key: `@` and 8 random symbols. */
export function generateDocumentId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	const symbols = Array.from(bytes, (byte) => AUTO_DOCUMENT_SYMBOLS[byte % 32]);
	return AUTO_DOCUMENT_PREFIX + symbols.join('');
}

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
		notes: attributes.notes ?? null,
		isEmployee: 1 === row.is_employee
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
// that's set is the manager's, and so is a provider's services. The ID number goes with a refund
// and is the contact's key: only the manager assigns it. Sales fills in an empty account.
function changesLockedField(current: Columns, next: Columns): boolean {
	return (
		current.services !== next.services ||
		current.document_id !== next.document_id ||
		isOverwritten(bankAccountOf(current), bankAccountOf(next))
	);
}

// The screen shows these fields locked to Sales; a save that changes them anyway was forged.
function requireLockedFieldsKept(actor: Actor, current: Columns, next: Columns): void {
	if (!isAdminOrManager(actor) && changesLockedField(current, next)) {
		error(403, 'Solo Gerente o Administrador cambian ese dato');
	}
}

/** Each field's first message, for the form to show under it. */
export function invalidForm(zodError: z.ZodError): SaveResult {
	const errors = Object.fromEntries(
		zodError.issues.map((issue) => [String(issue.path[0]), issue.message])
	);
	return { ok: false, message: CHECK_FIELDS, errors };
}

function documentRefusal(message: string): SaveResult {
	return { ok: false, message: CHECK_FIELDS, errors: { document_id: message } };
}

/** Why a document number can't be saved on contact `exceptId`: another contact has it. */
export async function documentTakenRefusal(
	db: D1Database,
	documentId: string,
	exceptId: number
): Promise<SaveResult | null> {
	// The UNIQUE column still guards a race; this turns the common case into a message, not a 500.
	const owner = await db
		.prepare('select full_name from contacts where document_id = ? and id != ?')
		.bind(documentId, exceptId)
		.first<{ full_name: string }>();
	return null === owner ? null : documentRefusal(`Esa cédula o NIT ya es de ${owner.full_name}`);
}

const AUTO_DOCUMENT_TYPED = documentRefusal(
	`Un documento no empieza con ${AUTO_DOCUMENT_PREFIX}: así empiezan los automáticos`
);

// Payroll prints it on every receipt: an employee's contact always has a real one.
const EMPLOYEE_DOCUMENT_REQUIRED = documentRefusal('Es empleado: la cédula no puede quedar vacía');

// A typed `@` would pass for an automatic document; the one already saved comes back as it was.
function isForgedAutoDocument(typed: string | null, current: string | null): boolean {
	return null !== typed && isAutoDocument(typed) && typed !== current;
}

// A blank keeps the automatic document there is, or makes one up.
function documentOrAuto(typed: string | null, current: string | null): string {
	if (null !== typed) {
		return typed;
	}
	return null !== current && isAutoDocument(current) ? current : generateDocumentId();
}

/** The document to save on a contact whose current one is `current`, or why it can't be saved. */
async function resolveDocument(
	db: D1Database,
	{ typed, current, exceptId }: { typed: string | null; current: string | null; exceptId: number }
): Promise<string | SaveResult> {
	if (isForgedAutoDocument(typed, current)) {
		return AUTO_DOCUMENT_TYPED;
	}
	const documentId = documentOrAuto(typed, current);
	return (await documentTakenRefusal(db, documentId, exceptId)) ?? documentId;
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
	requireLockedFieldsKept(actor, NEW_CONTACT, columns);
	const documentId = await resolveDocument(db, {
		typed: columns.document_id,
		current: null,
		exceptId: 0
	});
	if ('string' !== typeof documentId) {
		return documentId;
	}
	const statements = auditedInsert(db, {
		table: 'contacts',
		entityType: 'CONTACT',
		actor,
		values: { ...columns, document_id: documentId }
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
	requireLockedFieldsKept(actor, row, columns);
	if (1 === row.is_employee && null === columns.document_id) {
		return EMPLOYEE_DOCUMENT_REQUIRED;
	}
	const documentId = await resolveDocument(db, {
		typed: columns.document_id,
		current: row.document_id,
		exceptId: id
	});
	if ('string' !== typeof documentId) {
		return documentId;
	}
	return applyEdit(db, actor, { row, columns: { ...columns, document_id: documentId } });
}

/** «Cargar más» brings this many at a time; the list never loads the whole table. */
export const CONTACTS_PAGE_SIZE = 10;

// Filters come from the URL: an empty or tampered value is ignored, not an error. `pages` is how
// many «Cargar más» have been pressed plus one, capped so a typed URL can't ask for the whole table.
const listSchema = z.object({
	search: z.string().trim().catch(''),
	service: z.enum(SERVICES).optional().catch(undefined),
	pages: z.coerce.number().int().min(1).max(100).catch(1)
});

export type ContactSummary = {
	id: number;
	fullName: string;
	phone: string;
	services: Service[];
	isEmployee: boolean;
};

export type ContactFilters = z.output<typeof listSchema>;

/** The filters come back parsed: what the screen shows as chosen is what was applied. */
export type ContactPage = { contacts: ContactSummary[]; hasMore: boolean; filters: ContactFilters };

type Clause = { sql: string; params: string[] };

// Letters search the text (the name, unless told otherwise): every word somewhere in it, in any
// order, accents and case folded. Otherwise the digits typed, three or more, anywhere in the
// phone, so «442 8890» finds 573104428890: not the normalizer, a fragment isn't a phone.
function searchClause(search: string, textSql = foldedSql('full_name')): Clause | null {
	if (/\p{L}/u.test(search)) {
		const words = fold(search).split(/\s+/).filter(Boolean);
		return {
			sql: words.map(() => `${textSql} like ? escape '\\'`).join(' and '),
			params: words.map(containing)
		};
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

type SummaryRow = {
	id: number;
	full_name: string;
	phone: string;
	services: string;
	is_employee: number;
};

/** The first `pages` pages of contacts sorted by name, narrowed by name or phone and by service. */
export async function listContacts(
	db: D1Database,
	input: unknown,
	actor: Actor | null
): Promise<ContactPage> {
	requireRole(actor, EDITS_CONTACTS);
	const filters = listSchema.parse(input ?? {});
	const { search, service, pages } = filters;
	const shown = pages * CONTACTS_PAGE_SIZE;
	const clauses = [searchClause(search), serviceClause(service)].filter(
		(clause) => null !== clause
	);
	const where = clauses.map((clause) => `(${clause.sql})`).join(' and ') || '1';
	// ponytail: nocase folds ASCII only, so «Ángela» sorts after Z; a sort key column if it bothers.
	// One row past the pages says whether «Cargar más» has more to bring.
	const { results } = await db
		.prepare(
			`select contacts.id, full_name, phone, services, employees.id is not null as is_employee
			from contacts left join employees on employees.contact_id = contacts.id where ${where}
			order by full_name collate nocase, contacts.id limit ?`
		)
		.bind(...clauses.flatMap((clause) => clause.params), shown + 1)
		.all<SummaryRow>();
	const contacts = results.slice(0, shown).map((row) => ({
		id: row.id,
		fullName: row.full_name,
		phone: row.phone,
		services: servicesSchema.parse(JSON.parse(row.services)),
		isEmployee: 1 === row.is_employee
	}));
	return { contacts, hasMore: shown < results.length, filters };
}

/** A client added from the order form: the phone and the name typed, and an automatic document. */
export type NewClient = { phone: string; fullName: string; documentId: string };

/**
 * The contact's insert and its `CREATED` event, for the order's own `db.batch()`: the order then
 * finds its id by `document_id`, never by `last_insert_rowid()`.
 */
export function newClientStatements(
	db: D1Database,
	actor: Actor,
	client: NewClient
): D1PreparedStatement[] {
	return auditedInsert(db, {
		table: 'contacts',
		entityType: 'CONTACT',
		actor,
		values: {
			phone: client.phone,
			full_name: client.fullName,
			document_id: client.documentId,
			services: '[]',
			attributes: '{}'
		}
	});
}

/** A contact the order form lists: its name and address pre-fill the order. */
export type ClientCandidate = {
	id: number;
	fullName: string;
	phone: string;
	address1: string | null;
	address2: string | null;
};

// The name and both address lines, folded, so «diana poblado» finds Diana in El Poblado.
const CLIENT_TEXT_SQL = foldedSql(
	`full_name || ' ' || coalesce(json_extract(attributes, '$.address_1'), '') || ' ' ||
	coalesce(json_extract(attributes, '$.address_2'), '')`
);

/**
 * The first page of contacts by name whose name or address has every word typed, or whose phone
 * has the digits typed. None is picked for the salesperson: several may share a phone.
 */
export async function searchClients(
	db: D1Database,
	typed: unknown,
	actor: Actor | null
): Promise<ClientCandidate[]> {
	requireRole(actor, EDITS_CONTACTS);
	const clause = searchClause(z.string().trim().catch('').parse(typed), CLIENT_TEXT_SQL);
	if (null === clause) {
		return [];
	}
	const { results } = await db
		.prepare(
			`select id, phone, full_name, document_id, services, attributes, 0 as is_employee
			from contacts where ${clause.sql} order by full_name collate nocase, id limit ?`
		)
		.bind(...clause.params, CONTACTS_PAGE_SIZE)
		.all<ContactRow>();
	return results.map(toContact).map(({ id, fullName, phone, address1, address2 }) => ({
		id,
		fullName,
		phone,
		address1,
		address2
	}));
}

/** A carrier the order form offers: a contact with TRANSPORTER in its services. */
export type Transporter = { id: number; fullName: string; phone: string };

/** Every transporter by name, filtered in SQL. Creating one is the manager's, in Contactos. */
export async function listTransporters(
	db: D1Database,
	actor: Actor | null
): Promise<Transporter[]> {
	requireRole(actor, EDITS_CONTACTS);
	const { results } = await db
		.prepare(
			`select id, full_name as fullName, phone from contacts
			where exists (select 1 from json_each(contacts.services) where value = 'TRANSPORTER')
			order by full_name collate nocase, id`
		)
		.all<Transporter>();
	return results;
}
