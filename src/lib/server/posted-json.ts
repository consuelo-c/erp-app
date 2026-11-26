// A list the browser builds as the user types (an order's lines, a count's rows, an incident's
// items) is posted as JSON in one field; null when it isn't JSON. The service validates it.
export function readPostedJson(formData: FormData, field: string): unknown {
	try {
		return JSON.parse(String(formData.get(field)));
	} catch {
		return null;
	}
}
