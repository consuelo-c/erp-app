// Tests only: the one seam for test data. A fixture is the memory D1 with production's settings,
// and builders that write through the real services as the manager, so every row carries the audit
// columns and `events` row a real save leaves.
import { readFileSync } from 'node:fs';
import { getTodaysDate } from '$lib/datetime';
import { nextOperationalStatus, type OperationalStatus } from '$lib/orders';
import type { Actor, Role } from '../actor';
import { createContact, getContact, updateContact } from '../services/contacts';
import { createEmployee } from '../services/employees';
import { createLogin, getLogin } from '../services/logins';
import {
	advanceOrder,
	cancelOrder,
	getOrder,
	recordOrderPayment,
	type OrderStatus
} from '../services/orders';
import { createProduct, getProduct, updateProduct } from '../services/products';
import { convertQuote, createQuote } from '../services/quotes';
import { createMemoryD1 } from './memory-d1';

/** A partial of a service's own input, as its form posts it: merged over the builder's defaults. */
type Fields = Record<string, unknown>;

/**
 * The order's own input, plus where it ends up: `status` (CONFIRMED unless given), the status a
 * CANCELLED one is cancelled from (CONFIRMED unless given) and why, and `force: false` to have the
 * shortage check answer, as an availability test needs.
 */
type OrderFields = Fields & {
	status?: OrderStatus;
	cancelledFrom?: 'CONFIRMED' | 'PICKED' | 'OUT_FOR_DELIVERY';
	reason?: string;
	force?: boolean;
};

/** An employee's own input and its login's: `roles` required, `username` and `password` optional. */
type EmployeeFields = Fields & { roles: Role[]; username?: string; password?: string };

/** The pepper every fixture login's password is hashed with, for a test that logs in as one. */
export const TEST_PEPPER = 'test-pepper';

/** The password of every fixture login, unless the test types another. */
export const TEST_PASSWORD = 'clave-de-prueba';

// The price a builder's own product rents at, for the line it quotes.
const DEFAULT_RENTAL_PRICE = 10_000;

// Far enough ahead that a default quote stays VALID whatever day the suite runs.
const DEFAULT_VALID_UNTIL = '2099-12-31';

const DEFAULT_TRIP = { time: null, address_1: 'Calle 10 # 43-12' };

/** A login with these roles and no employee behind it. */
export function actorWith(...roles: Role[]): Actor {
	return { username: roles.join('-').toLowerCase(), employeeId: null, roles, kind: 'user' };
}

export const ADMIN = actorWith('ADMIN');
export const MANAGER = actorWith('MANAGER');
export const SALES = actorWith('SALES');
export const WAREHOUSE = actorWith('WAREHOUSE');
export const DRIVER = actorWith('DRIVER');

/** One fixture's database, and the counter that keeps its phones, ID numbers and names apart. */
type Context = { db: D1Database; next: () => number };

type Saved = { ok: true; id: number } | { ok: false; message: string };

// A broken default must read as a setup error naming the service's reason, not a later mismatch.
function savedId(builder: string, result: Saved): number {
	if (!result.ok) {
		const { message, ...details } = result;
		throw new Error(`${builder}() was refused: ${message} ${JSON.stringify(details)}`);
	}
	return result.id;
}

/** A contact through Contactos › Nuevo, with a name, a phone and an ID number of its own. */
async function contact({ db, next }: Context, fields: Fields = {}): Promise<number> {
	const number = next();
	const defaults = {
		full_name: `Contacto ${number}`,
		phone: `300${String(number).padStart(7, '0')}`,
		document_id: String(10_000_000 + number)
	};
	return savedId('contact', await createContact(db, { ...defaults, ...fields }, MANAGER));
}

/** A product through Productos › Nuevo: active, 100 in stock, at $10.000 a day. */
async function product({ db, next }: Context, fields: Fields = {}): Promise<number> {
	const defaults = {
		name: `Producto ${next()}`,
		category: 'CHAIRS_TABLES',
		rental_price: String(DEFAULT_RENTAL_PRICE),
		total_quantity: '100',
		active: 'on'
	};
	return savedId('product', await createProduct(db, { ...defaults, ...fields }, MANAGER));
}

type Client = { client_id: number | null; client_name: string };

// The name the order or quote freezes is the contact's own; null is «Cliente nuevo».
async function clientOf(context: Context, fields: Fields): Promise<Client> {
	if (null === fields.client_id) {
		return { client_id: null, client_name: `Cliente nuevo ${context.next()}` };
	}
	const clientId = 'number' === typeof fields.client_id ? fields.client_id : await contact(context);
	const client = await getContact(context.db, clientId, MANAGER);
	return { client_id: clientId, client_name: client?.fullName ?? '' };
}

// One unit of a product of its own, at its catalog price.
async function defaultLines(context: Context): Promise<Fields[]> {
	const productId = await product(context);
	return [{ product_id: productId, qty: 1, unit_price: DEFAULT_RENTAL_PRICE }];
}

/** A quote through Cotizaciones › Nueva; its own client and one product unless given. */
async function quote(context: Context, fields: Fields = {}): Promise<number> {
	const defaults = {
		...(await clientOf(context, fields)),
		valid_until: DEFAULT_VALID_UNTIL,
		rental_days: 1,
		quote_items: fields.quote_items ?? (await defaultLines(context)),
		transported_by: 'COMPANY'
	};
	return savedId('quote', await createQuote(context.db, { ...defaults, ...fields }, MANAGER));
}

/**
 * An existing order moved forward to `target`, one legal transition at a time as the status button
 * moves it, so each leaves its event.
 */
async function advanceTo(
	{ db }: Context,
	id: number,
	target: OperationalStatus | 'CONFIRMED'
): Promise<void> {
	for (;;) {
		const current = await getOrder(db, id, MANAGER);
		if (null === current) {
			throw new Error(`advanceTo(): order ${id} not found`);
		}
		if (target === current.status) {
			return;
		}
		const to = nextOperationalStatus({
			from: current.status,
			deliveryMethod: current.delivery.method,
			returnMethod: current.pickup.method
		});
		if (null === to) {
			throw new Error(`advanceTo() can't reach ${target} from ${current.status} by its methods`);
		}
		savedId('advanceTo', await advanceOrder(db, { id, status: to }, MANAGER));
	}
}

// The quote the order converts: the order's client and lines, so they read as quoted. A «Cliente
// nuevo» order's quote is a «Cliente nuevo» one too, typed with the same name and phone.
async function quoteFor(context: Context, order: Fields): Promise<number> {
	const { client_id, client_name, client_phone, client_whatsapp } = order;
	const client = { client_id, client_name, client_phone, client_whatsapp };
	return quote(context, {
		...client,
		quote_items: order.order_items,
		rental_days: order.rental_days
	});
}

type Conversion = { order: Fields; force: boolean };

// «Guardar pedido» on the quote's form: born CONFIRMED, «Guardar de todos modos» unless `force: false`.
async function convert(context: Context, { order: input, force }: Conversion): Promise<number> {
	const client = await clientOf(context, input);
	const lines = input.order_items ?? (await defaultLines(context));
	const defaults = {
		...client,
		event_date: '2030-06-15',
		delivery_date: '2030-06-14',
		pickup_date: '2030-06-16',
		rental_days: 1,
		delivery_attributes: { ...DEFAULT_TRIP, method: 'COMPANY_DELIVERY' },
		pickup_attributes: { ...DEFAULT_TRIP, method: 'COMPANY_PICKUP' },
		order_items: lines,
		transport_cost: 0
	};
	const order = { ...defaults, ...input };
	const quoteId = await quoteFor(context, order);
	const conversion = { quote: quoteId, order, force };
	return savedId('order', await convertQuote(context.db, conversion, MANAGER));
}

/**
 * An order born the only way a real one is, converting a quote of its client and lines, then
 * moved to `status` along the legal path. Its own client and product unless given; transport $0.
 */
async function order(context: Context, fields: OrderFields = {}): Promise<number> {
	const {
		status = 'CONFIRMED',
		cancelledFrom = 'CONFIRMED',
		reason = 'El cliente canceló',
		force = true,
		...input
	} = fields;
	const id = await convert(context, { order: input, force });
	if ('CANCELLED' !== status) {
		await advanceTo(context, id, status);
		return id;
	}
	await advanceTo(context, id, cancelledFrom);
	savedId('order', await cancelOrder(context.db, { id, reason }, MANAGER));
	return id;
}

/** An edit through a form: the row's id, what is typed over it, and who saves it. */
type Edit = { id: number; changes: Fields; actor: Actor };

// An empty field posts as empty text, as a form does, never as null.
function asPosted(values: Record<string, string | number | null>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(values).map(([key, value]) => [key, null === value ? '' : String(value)])
	);
}

/** Contactos › Editar: the contact read back and its whole form posted, `changes` typed over it. */
async function editContact({ db }: Context, { id, changes, actor }: Edit): Promise<void> {
	const current = await getContact(db, id, MANAGER);
	if (null === current) {
		throw new Error(`editContact(): contact ${id} not found`);
	}
	const typed = asPosted({
		phone: current.phone,
		whatsapp: current.whatsapp,
		full_name: current.fullName,
		document_id: current.documentId,
		email: current.email,
		address_1: current.address1,
		address_2: current.address2,
		bank_account: current.bankAccount,
		notes: current.notes
	});
	const form = { id, ...typed, labels: current.labels, ...changes };
	savedId('editContact', await updateContact(db, form, actor));
}

/** Productos › Editar: the product read back and its whole form posted, `changes` typed over it. */
async function editProduct({ db }: Context, { id, changes, actor }: Edit): Promise<void> {
	const current = await getProduct(db, id, MANAGER);
	if (null === current) {
		throw new Error(`editProduct(): product ${id} not found`);
	}
	const typed = asPosted({
		name: current.name,
		category: current.category,
		variant_group: current.variantGroup,
		variant_name: current.variantName,
		description: current.description,
		website_url: current.websiteUrl,
		replacement_cost: current.replacementCost,
		rental_price: current.rentalPrice,
		active: current.isActive ? 'on' : 'off'
	});
	savedId('editProduct', await updateProduct(db, { id, ...typed, ...changes }, actor));
}

/** A «Pago» in cash today through the order's payment entry: its real movement and receipt. */
async function payment({ db }: Context, orderId: number, fields: Fields = {}): Promise<number> {
	const defaults = {
		order_id: String(orderId),
		concept: 'INSTALLMENT',
		payment_method: 'CASH',
		amount: '10.000',
		movement_date: getTodaysDate()
	};
	return savedId('payment', await recordOrderPayment(db, { ...defaults, ...fields }, MANAGER));
}

// On payroll since 2024, so any week a test settles finds them employed.
async function hire({ db, next }: Context, fields: Fields): Promise<number> {
	const number = next();
	const defaults = {
		full_name: `Empleado ${number}`,
		phone: `301${String(number).padStart(7, '0')}`,
		document_id: String(20_000_000 + number),
		monthly_salary: '1.750.905',
		position: 'Bodega',
		start: '2024-01-01'
	};
	return savedId('employee', await createEmployee(db, { ...defaults, ...fields }, MANAGER));
}

/**
 * A person on payroll with a login: their contact, employee and login through Empleados and
 * Logins, read back as the login's `Actor`. Logins are the admin's alone, so that write is.
 */
async function employee(context: Context, fields: EmployeeFields): Promise<Actor> {
	const { roles, username, password = TEST_PASSWORD, ...input } = fields;
	const employeeId = await hire(context, input);
	const login = {
		username: username ?? `empleado${context.next()}`,
		roles,
		employee_id: employeeId,
		password
	};
	const environment = { db: context.db, pepper: TEST_PEPPER };
	const loginId = savedId('employee', await createLogin(environment, login, ADMIN));
	const stored = await getLogin(context.db, loginId, ADMIN);
	return {
		username: stored?.username ?? login.username,
		employeeId,
		roles: stored?.roles ?? roles,
		kind: 'user'
	};
}

/** A ready database: every migration and the default settings; the real catalog on request. */
export function createFixture({ catalog = false }: { catalog?: boolean } = {}) {
	const { db, database } = createMemoryD1();
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	if (catalog) {
		database.exec(readFileSync('scripts/catalog.sql', 'utf8'));
	}
	let sequence = 0;
	const context: Context = { db, next: () => (sequence += 1) };
	return {
		db,
		database,
		contact: (fields?: Fields) => contact(context, fields),
		product: (fields?: Fields) => product(context, fields),
		quote: (fields?: Fields) => quote(context, fields),
		order: (fields?: OrderFields) => order(context, fields),
		advanceTo: (id: number, target: OperationalStatus | 'CONFIRMED') =>
			advanceTo(context, id, target),
		editContact: (id: number, changes: Fields, actor: Actor = MANAGER) =>
			editContact(context, { id, changes, actor }),
		editProduct: (id: number, changes: Fields, actor: Actor = MANAGER) =>
			editProduct(context, { id, changes, actor }),
		payment: (orderId: number, fields?: Fields) => payment(context, orderId, fields),
		employee: (fields: EmployeeFields) => employee(context, fields)
	};
}
