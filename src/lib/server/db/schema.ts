import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
	unique,
	uniqueIndex,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';

const auditColumns = {
	createdAt: integer('created_at').notNull(),
	createdBy: text('created_by').notNull(),
	updatedAt: integer('updated_at').notNull(),
	updatedBy: text('updated_by').notNull()
};

// Module, label, unit and Zod schema of each key live in src/lib/settings.ts, not in a column.
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	...auditColumns
});

// Append-only. Drizzle can't express triggers, so the initial migration appends two by hand that
// abort any UPDATE or DELETE: re-add them whenever migrations/ is squashed or a migration recreates
// the table (drizzle does, to add a CHECK).
export const events = sqliteTable(
	'events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		entityType: text('entity_type').notNull(),
		entityId: integer('entity_id'),
		// The key of an entity keyed by text, a `settings` key; never set together with entity_id.
		entityKey: text('entity_key'),
		action: text('action').notNull(),
		actorUsername: text('actor_username').notNull(),
		actorKind: text('actor_kind').notNull(),
		before: text('before'),
		after: text('after'),
		reason: text('reason'),
		ip: text('ip'),
		userAgent: text('user_agent'),
		createdAt: integer('created_at').notNull()
	},
	(table) => [
		check(
			'events_actor_kind',
			sql`${table.actorKind} IN ('user', 'system', 'agent', 'integration')`
		),
		check('events_entity_id_or_key', sql`${table.entityId} IS NULL OR ${table.entityKey} IS NULL`)
	]
);

// The company's clients, providers and employees: one document, one row; a phone may be shared, as
// a company's switchboard is by its branches. Email, address, bank account and notes live in
// `attributes` (JSON, validated with Zod). Being a client or an employee isn't stored: orders or an
// `employees` row point here; an empty `services` means it isn't a provider.
export const contacts = sqliteTable('contacts', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	phone: text('phone').notNull(), // digits with country code: 573104428890
	fullName: text('full_name').notNull(),
	// Cédula, NIT or passport, normalized; when none is given, `@` and 8 random characters.
	documentId: text('document_id').notNull().unique(),
	services: text('services').notNull().default('[]'), // JSON: ["TRANSPORTER","DECORATOR"]
	attributes: text('attributes').notNull().default('{}'),
	...auditColumns
});

// The people on payroll. Name, phone and ID number are the contact's; salary, position, payroll
// account and employment periods live in `attributes` (JSON, validated with Zod); "currently
// employed" is the last period having no end, so there's no `active`.
export const employees = sqliteTable('employees', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	contactId: integer('contact_id')
		.notNull()
		.unique()
		.references(() => contacts.id),
	attributes: text('attributes').notNull().default('{}'),
	...auditColumns
});

// The logins. A login isn't a person: `employee_id` is null for a login not on payroll, and moves
// to the new hire when a login is reassigned.
export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(), // lowercase
	roles: text('roles').notNull(), // JSON, validated with Zod
	employeeId: integer('employee_id')
		.unique()
		.references(() => employees.id),
	passwordHash: text('password_hash').notNull(),
	passwordSalt: text('password_salt').notNull(),
	passwordIterations: integer('password_iterations').notNull(),
	active: integer('active').notNull().default(1),
	...auditColumns
});

// `id` is the SHA-256 of the session token, never the token: a leaked table hands over no sessions.
export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		expiresAt: integer('expires_at').notNull(),
		...auditColumns
	},
	(table) => [index('sessions_user_id').on(table.userId)]
);

// A day's four punches, `HH:MM` or null. `employee_id` is whose hours they are, not who typed them,
// and points to the person, not the login. No payment fields: a day is paid when a PAID settlement
// of that employee covers it.
export const timesheets = sqliteTable(
	'timesheets',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		employeeId: integer('employee_id')
			.notNull()
			.references(() => employees.id),
		workDate: text('work_date').notNull(), // YYYY-MM-DD
		morningIn: text('morning_in'),
		morningOut: text('morning_out'),
		afternoonIn: text('afternoon_in'),
		afternoonOut: text('afternoon_out'),
		...auditColumns
	},
	(table) => [unique('timesheets_employee_id_work_date').on(table.employeeId, table.workDate)]
);

// One settlement per employee per week. Born DRAFT, PAID once its payment is recorded, then frozen.
// `employee_snapshot` and `settings_snapshot` are rewritten on every draft save and final once PAID.
export const payrollRuns = sqliteTable(
	'payroll_runs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		employeeId: integer('employee_id')
			.notNull()
			.references(() => employees.id),
		status: text('status').notNull().default('DRAFT'),
		weekNumber: integer('week_number').notNull(), // the company's own count, resets in January
		periodStart: text('period_start').notNull(), // Monday
		periodEnd: text('period_end').notNull(), // Saturday
		paymentDate: text('payment_date').notNull(),
		employeeSnapshot: text('employee_snapshot').notNull(), // JSON: name, ID number, position, hire date
		preparedBy: text('prepared_by').notNull(), // the receipt's «Elaboró:»
		earnings: text('earnings').notNull(), // JSON, validated with Zod
		deductions: text('deductions').notNull(), // JSON, validated with Zod
		settingsSnapshot: text('settings_snapshot').notNull(), // JSON, holidays included
		totalEarnings: integer('total_earnings').notNull(),
		totalDeductions: integer('total_deductions').notNull(),
		netPay: integer('net_pay').notNull(),
		...auditColumns
	},
	(table) => [
		unique('payroll_runs_employee_id_period_start').on(table.employeeId, table.periodStart),
		check('payroll_runs_status', sql`${table.status} IN ('DRAFT', 'PAID')`)
	]
);

// The rental catalog. A variant is a complete, sellable row of its own (price, quantity), never
// a child of a parent row: `variant_group` + `variant_name` only group it on the catalog screen.
export const products = sqliteTable(
	'products',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(), // the full name, frozen into orders: never composed from the variant
		category: text('category').notNull(),
		variantGroup: text('variant_group'),
		variantName: text('variant_name'),
		description: text('description'),
		rentalPrice: integer('rental_price').notNull(), // whole pesos per day
		totalQuantity: integer('total_quantity').notNull(),
		active: integer('active').notNull().default(1),
		...auditColumns
	},
	(table) => [
		uniqueIndex('products_variant_unique').on(
			sql`${table.variantGroup} COLLATE NOCASE`,
			sql`${table.variantName} COLLATE NOCASE`
		),
		check(
			'products_category',
			sql`${table.category} IN ('CHAIRS_TABLES', 'LINENS', 'GLASSWARE', 'CUTLERY', 'TABLEWARE', 'CHAFERS_TRAYS', 'DECOR')`
		)
	]
);

// `id` is the number printed as «Pedido #1043», continuing the paper sequence. What the app filters,
// sorts or indexes is a column; what it only reads lives in four JSON columns, validated with Zod:
// the client's snapshot, each trip (method, time, address, carrier) and the rest (`attributes`).
// The lines are JSON too, with `name` and `list_price` frozen when each is added.
export const orders = sqliteTable(
	'orders',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		publicToken: text('public_token').notNull().unique(), // crypto.randomUUID()
		clientId: integer('client_id')
			.notNull()
			.references(() => contacts.id),
		status: text('status').notNull(),
		hasIncident: integer('has_incident').notNull().default(0),
		eventDate: text('event_date').notNull(), // YYYY-MM-DD
		deliveryDate: text('delivery_date').notNull(),
		pickupDate: text('pickup_date').notNull(),
		rentalDays: integer('rental_days').notNull(), // drives the price, never derived from the dates
		clientAttributes: text('client_attributes').notNull(),
		deliveryAttributes: text('delivery_attributes').notNull(),
		pickupAttributes: text('pickup_attributes').notNull(),
		orderItems: text('order_items').notNull(),
		itemsTotal: integer('items_total').notNull(), // whole pesos, like every money column
		discount: integer('discount').notNull().default(0),
		transportCost: integer('transport_cost').notNull().default(0),
		orderTotal: integer('order_total').notNull(),
		depositAmount: integer('deposit_amount').notNull().default(0), // held, never part of the total
		attributes: text('attributes').notNull().default('{}'),
		...auditColumns
	},
	(table) => [
		index('orders_delivery_date').on(table.deliveryDate),
		index('orders_pickup_date').on(table.pickupDate),
		index('orders_event_date').on(table.eventDate),
		index('orders_status').on(table.status),
		index('orders_client_id').on(table.clientId),
		check(
			'orders_status',
			sql`${table.status} IN ('DRAFT', 'CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'OUT_FOR_PICKUP', 'COMPLETED', 'CANCELLED')`
		),
		// coalesce: a missing method makes json_extract NULL, and a CHECK that evaluates to NULL passes.
		check(
			'orders_delivery_method',
			sql`coalesce(json_extract(${table.deliveryAttributes}, '$.method'), '') IN ('COMPANY_DELIVERY', 'CLIENT_PICKUP', 'EXTERNAL_CARRIER')`
		),
		check(
			'orders_pickup_method',
			sql`coalesce(json_extract(${table.pickupAttributes}, '$.method'), '') IN ('COMPANY_PICKUP', 'CLIENT_RETURN', 'EXTERNAL_CARRIER')`
		)
	]
);

// Damage or loss found on a return. Never deleted: a mistake is reversed, which keeps the row.
// `reversed_by` is apart from `updated_by`, so a later edit doesn't lose who reversed it.
export const incidents = sqliteTable(
	'incidents',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		orderId: integer('order_id')
			.notNull()
			.references(() => orders.id),
		incidentItems: text('incident_items').notNull(), // JSON, validated with Zod: each product's outcome
		incidentDescription: text('incident_description').notNull(),
		responsibleParty: text('responsible_party').notNull().default('UNDETERMINED'),
		status: text('status').notNull().default('ACTIVE'),
		reversalReason: text('reversal_reason'),
		reversedBy: text('reversed_by'), // username
		reversedAt: integer('reversed_at'),
		...auditColumns
	},
	(table) => [
		index('incidents_order_id').on(table.orderId),
		check(
			'incidents_responsible_party',
			sql`${table.responsibleParty} IN ('UNDETERMINED', 'CLIENT', 'CARRIER', 'COMPANY')`
		),
		check('incidents_status', sql`${table.status} IN ('ACTIVE', 'REVERSED')`)
	]
);

// All the company's money: the sign is the direction (+ in, − out). Immutable by rule, not by
// schema: no route edits or deletes a movement, a mistake is corrected with an offsetting one.
// Linked like `events`, by entity_type + entity_id with no foreign key, so a new business line
// never adds a column here: the per-concept CHECK fixes the entity_type and the sign instead.
export const cashMovements = sqliteTable(
	'cash_movements',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		concept: text('concept').notNull(),
		paymentMethod: text('payment_method').notNull(),
		amount: integer('amount').notNull(), // whole pesos, negative is an outflow
		movementDate: text('movement_date').notNull(), // YYYY-MM-DD
		entityType: text('entity_type'), // 'ORDER' | 'PAYROLL_RUN'
		entityId: integer('entity_id'),
		payee: text('payee'), // a third party: carrier, supplier
		attributes: text('attributes').notNull().default('{}'), // JSON, validated with Zod
		// Recibo de caja (+) and comprobante de egreso (−) consecutives: one sequence per sign.
		receiptNumber: integer('receipt_number').notNull(),
		// The movement this one offsets: same concept and link, opposite sign. At most one per movement.
		reversesId: integer('reverses_id')
			.unique()
			.references((): AnySQLiteColumn => cashMovements.id),
		...auditColumns
	},
	(table) => [
		index('cash_movements_entity').on(table.entityType, table.entityId),
		uniqueIndex('cash_movements_receipt_number').on(
			sql`(${table.amount} > 0)`,
			table.receiptNumber
		),
		check('cash_movements_amount', sql`${table.amount} <> 0`),
		check(
			'cash_movements_entity_pair',
			sql`(${table.entityType} IS NULL) = (${table.entityId} IS NULL)`
		),
		// `IS`, not `=`: a CHECK passes when it evaluates to NULL. `ELSE 0` also refuses an unknown concept.
		// A concept's natural sign flips only on an offsetting movement, the one with reverses_id.
		check(
			'cash_movements_concept_link',
			sql`CASE
				WHEN ${table.concept} IN ('INSTALLMENT', 'SECURITY_DEPOSIT') THEN ${table.entityType} IS 'ORDER' AND (${table.amount} > 0) = (${table.reversesId} IS NULL)
				WHEN ${table.concept} IN ('INSTALLMENT_REFUND', 'DEPOSIT_REFUND', 'CARRIER_PAYMENT') THEN ${table.entityType} IS 'ORDER' AND (${table.amount} < 0) = (${table.reversesId} IS NULL)
				WHEN ${table.concept} = 'PAYROLL' THEN ${table.entityType} IS 'PAYROLL_RUN' AND (${table.amount} < 0) = (${table.reversesId} IS NULL)
				WHEN ${table.concept} = 'OTHER_INCOME' THEN ${table.entityType} IS NULL AND (${table.amount} > 0) = (${table.reversesId} IS NULL)
				WHEN ${table.concept} = 'OTHER_EXPENSE' THEN ${table.entityType} IS NULL AND (${table.amount} < 0) = (${table.reversesId} IS NULL)
				ELSE 0
			END`
		),
		check(
			'cash_movements_payment_method',
			sql`${table.paymentMethod} IN ('CASH', 'TRANSFER', 'OTHER')`
		)
	]
);
