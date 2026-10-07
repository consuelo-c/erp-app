// Order timeline visibility: filter an order's `events` rows down to what each role may see,
// keeping only status changes and stripping money fields for `WAREHOUSE` and `DRIVER`.

import { z } from 'zod';
import { hasAnyRole, type Actor } from './actor';
import { eventFieldsSchema } from './audit';

/** An `events` row as read for a timeline; `before`/`after` are absent until an event is expanded. */
export type TimelineEvent = {
	action: string;
	before?: string | null;
	after?: string | null;
};

// Cancelling is a status change too: the warehouse and the driver must know not to deliver.
const STATUS_ACTIONS = ['STATUS_CHANGED', 'CANCELLED'];

// Order totals, payments, and the per-line prices inside `order_items`.
const MONEY_FIELDS = [
	'items_total',
	'discount',
	'transport_cost',
	'order_total',
	'deposit_amount',
	'amount',
	'list_price',
	'unit_price',
	'line_total'
];

const orderItemsSchema = z.array(z.record(z.string(), z.unknown()));

function withoutMoneyFields<T extends Record<string, unknown>>(fields: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(fields).filter(([field]) => !MONEY_FIELDS.includes(field))
	) as Partial<T>;
}

function stripOrderItemsMoney(orderItemsJson: string): string {
	const items = orderItemsSchema.parse(JSON.parse(orderItemsJson));
	return JSON.stringify(items.map(withoutMoneyFields));
}

function stripMoney(json: string | null | undefined): string | null | undefined {
	if (null === json || undefined === json) {
		return json;
	}
	const fields = withoutMoneyFields(eventFieldsSchema.parse(JSON.parse(json)));
	if ('string' === typeof fields.order_items) {
		fields.order_items = stripOrderItemsMoney(fields.order_items);
	}
	return JSON.stringify(fields);
}

/** Who sees edits and money on an order's timeline. */
function canSeeOrderEdits(actor: Actor): boolean {
	return hasAnyRole(actor, ['SALES', 'MANAGER', 'ADMIN']);
}

/**
 * The events of an order's timeline that `actor` may see. `SALES`, `MANAGER` and `ADMIN` get every
 * row as is. Anyone else (`WAREHOUSE`, `DRIVER`) gets only status changes, with the money fields
 * removed from `before`/`after`.
 */
export function filterTimelineForActor<T extends TimelineEvent>(events: T[], actor: Actor): T[] {
	if (canSeeOrderEdits(actor)) {
		return events;
	}
	return events
		.filter((event) => STATUS_ACTIONS.includes(event.action))
		.map((event) => ({
			...event,
			before: stripMoney(event.before),
			after: stripMoney(event.after)
		}));
}
