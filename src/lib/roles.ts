export const ROLES = ['ADMIN', 'MANAGER', 'SALES', 'WAREHOUSE', 'DRIVER'] as const;

export type Role = (typeof ROLES)[number];

/**
 * Who may do each thing, keyed by capability rather than by the roles it holds today: two keys
 * with the same roles stay two, so either can change alone. Every guard and menu page names one.
 */
export const POLICIES = {
	anyLogin: ROLES,
	orders: ['ADMIN', 'MANAGER', 'SALES'],
	quotes: ['ADMIN', 'MANAGER', 'SALES'],
	receivables: ['ADMIN', 'MANAGER', 'SALES'],
	fullTimeline: ['ADMIN', 'MANAGER', 'SALES'],
	recordsPayments: ['ADMIN', 'MANAGER', 'SALES', 'DRIVER'],
	paysOut: ['ADMIN', 'MANAGER'],
	driverPayments: ['DRIVER'],
	paymentReceipts: ['ADMIN', 'MANAGER', 'SALES'],
	// The drawer: their cash is already the company's, so they have no tab.
	managesCash: ['ADMIN', 'MANAGER'],
	// The roles that take cash for the company: the warehouse never does.
	takesCash: ['SALES', 'DRIVER'],
	readsCashTab: ['ADMIN', 'MANAGER', 'SALES', 'DRIVER'],
	contacts: ['ADMIN', 'MANAGER', 'SALES'],
	lockedContactFields: ['ADMIN', 'MANAGER'],
	contactLabels: ['ADMIN', 'MANAGER'],
	products: ['ADMIN', 'MANAGER', 'SALES'],
	manageProducts: ['ADMIN', 'MANAGER'],
	inventoryCount: ['ADMIN', 'MANAGER', 'WAREHOUSE', 'DRIVER'],
	inventoryReview: ['ADMIN', 'MANAGER'],
	incidents: ['ADMIN', 'MANAGER'],
	employees: ['ADMIN', 'MANAGER'],
	payroll: ['ADMIN', 'MANAGER'],
	everyonesHours: ['ADMIN', 'MANAGER'],
	logins: ['ADMIN'],
	settings: ['ADMIN', 'MANAGER'],
	overrideClosedDate: ['ADMIN'],
	reports: ['ADMIN', 'MANAGER'],
	subrental: ['ADMIN', 'MANAGER', 'SALES'],
	cashBookLink: ['ADMIN', 'MANAGER']
} as const satisfies Record<string, readonly Role[]>;

export type Policy = keyof typeof POLICIES;
