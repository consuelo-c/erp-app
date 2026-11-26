// The order and quote forms post the whole record as JSON in one field: its lines are a list the
// browser builds as the salesperson types. The service validates it like any other input.
export function readPostedJson(formData: FormData, field: string): unknown {
	try {
		return JSON.parse(String(formData.get(field)));
	} catch {
		return null;
	}
}
