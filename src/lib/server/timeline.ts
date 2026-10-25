// Order timeline visibility: filter an order's `events` rows down to what each role may see.
// Money isn't hidden from any role: the printout everyone carries already shows the prices.

import { hasAnyRole, type Actor } from './actor';

/** An `events` row as read for a timeline; its `before`/`after`, when read, pass through as they are. */
export type TimelineEvent = { action: string };

// Cancelling is a status change too: the warehouse and the driver must know not to deliver.
const STATUS_ACTIONS = ['STATUS_CHANGED', 'CANCELLED'];

/** Who sees edits on an order's timeline. */
function canSeeOrderEdits(actor: Actor): boolean {
	return hasAnyRole(actor, ['SALES', 'MANAGER', 'ADMIN']);
}

/**
 * The events of an order's timeline that `actor` may see. `SALES`, `MANAGER` and `ADMIN` get every
 * row. Anyone else (`WAREHOUSE`, `DRIVER`) gets only status changes, `before`/`after` intact.
 */
export function filterTimelineForActor<T extends TimelineEvent>(events: T[], actor: Actor): T[] {
	if (canSeeOrderEdits(actor)) {
		return events;
	}
	return events.filter((event) => STATUS_ACTIONS.includes(event.action));
}
