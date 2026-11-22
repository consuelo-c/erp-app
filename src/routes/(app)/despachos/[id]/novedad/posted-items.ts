// The items are a list the browser builds, posted as JSON in one field.
export function readPostedItems(value: FormDataEntryValue | null): unknown {
	try {
		return JSON.parse(String(value));
	} catch {
		return null;
	}
}
