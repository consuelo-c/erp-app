import type { z } from 'zod';

/** A save the service won't make: the banner's message, and each marked field's message by its path. */
export type Refusal = { ok: false; message: string; errors: Record<string, string> };

export type SaveResult<Saved extends object = object> = ({ ok: true } & Saved) | Refusal;

const CHECK_FIELDS = 'Revisa los campos marcados en rojo antes de guardar.';

/** One field marked, under the default banner. */
export function refusal(field: string, message: string): Refusal {
	return fieldsRefusal({ [field]: message });
}

/** Several fields marked at once, under the default banner. */
export function fieldsRefusal(errors: Record<string, string>): Refusal {
	return { ok: false, message: CHECK_FIELDS, errors };
}

/** A refusal of the whole entry under its own message, marking `field`, if given, with the same message. */
export function messageRefusal(message: string, field?: string): Refusal {
	return { ok: false, message, errors: undefined === field ? {} : { [field]: message } };
}

/** Each field's message under its whole path, as `order_items.2.qty` or `delivery_attributes.carrier_id`. */
export function invalid(zodError: z.ZodError): Refusal {
	return fieldsRefusal(
		Object.fromEntries(zodError.issues.map((issue) => [issue.path.join('.'), issue.message]))
	);
}
