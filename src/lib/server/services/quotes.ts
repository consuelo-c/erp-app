// Cotizaciones: an order without its trips or its money. What it shares with the order is code,
// not rows: its lines are validated with `orderItemsSchema` and its client's snapshot with
// `clientAttributesSchema`, both imported from the order service, never redefined here.

import { z } from 'zod';

const textSchema = z.string().min(1);

// The second line of «Lugar del evento» completes the first, as on an order's trip.
function hasFirstAddressLine(attributes: { address_1?: string; address_2?: string }): boolean {
	return undefined === attributes.address_2 || undefined !== attributes.address_1;
}

// SQLite validates nothing: checked on write and on read. A new key is a code change.
export const quoteAttributesSchema = z
	.strictObject({
		address_1: textSchema.optional(),
		address_2: textSchema.optional(),
		notes: textSchema.optional()
	})
	.refine(hasFirstAddressLine, 'The second address line needs the first');

export type QuoteAttributes = z.infer<typeof quoteAttributesSchema>;
