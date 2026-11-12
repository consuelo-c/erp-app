// Tests only. An order is born only by converting a quote: this inserts a bare VALID quote for the
// order's client, one line of the first active product at its catalog price (frozen as the catalog
// would), and converts it with the order as typed, so the order's own validation answers. `force`
// skips the shortage check, as «Guardar de todos modos» does.
import type { Actor } from '../actor';
import { convertQuote } from '../services/quotes';

export async function createOrder(db: D1Database, input: object, actor: Actor | null) {
	const clientId = (input as { client_id?: number | null }).client_id ?? null;
	const quote = await db
		.prepare(
			`insert into quotes (public_token, client_id, valid_until, rental_days, client_attributes,
			quote_items, items_total, quote_total, created_at, created_by, updated_at, updated_by)
			select ?, coalesce(?, (select min(id) from contacts)), '2099-12-31', 1,
				'{"name":"-","phone":"-","whatsapp":null}',
				json_array(json_object('product_id', id, 'name', name, 'qty', 1, 'list_price', rental_price,
					'unit_price', rental_price, 'line_total', rental_price)),
				rental_price, rental_price, 0, 'test', 0, 'test'
			from products where active = 1 order by id limit 1
			returning id`
		)
		.bind(crypto.randomUUID(), clientId)
		.first<{ id: number }>();
	// A quote's order types its transport; the tests' orders leave it out for $0.
	const order = { quote: quote?.id, order: { transport_cost: 0, ...input }, force: true };
	return convertQuote(db, order, actor);
}
