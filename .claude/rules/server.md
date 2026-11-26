---
paths:
  - 'src/lib/server/**'
  - 'src/routes/**/*.server.ts'
  - 'src/routes/**/+server.ts'
---

# Server rules

- Business logic lives in `src/lib/server/services/`: a service takes `(input, actor)` and knows nothing about transport (no cookies, `locals` or `Request`). Routes only resolve the actor, call the service and render.
- A capability is a `POLICIES` key (`src/lib/roles.ts`), and every guard names one. `requireRole(actor, POLICIES.<key>)` is the first line of every endpoint and server `load`, except `/`, `/login`, `/mi-pedido/[token]` and `/mi-cotizacion/[token]`; the service it calls opens with `requireRole` on its own key. Other checks are `hasAnyRole(actor, POLICIES.<key>)`: a login holds several roles. A new capability is a new key, even with the same roles as another.
- `requireRole` is a service's only throw. A service returns `null` for a missing record, or `{ missing: '<what>' }` when the page tells two missing cases apart (payroll's `getReceipt`, timesheets); a refusal is a `SaveResult` refusal from `result.ts`: `refusal(field, message)` for one field, `fieldsRefusal(errors)` for several, `invalid(zodError)` for a Zod failure (errors keyed by the joined path, as `order_items.2.qty`), all under the one default banner, and `messageRefusal(message)` for a banner with no field (screens that show only the banner keep their Zod text with `messageRefusal(issues[0].message)`). The route maps a missing record to `error(404)` and a refusal to `fail(400, …)`, or to `error(400)` in a `load`.
- The database is `getDb(platform)` and the Worker's secrets `getEnv(platform)`, both from `platform.ts`.
- Lists build on `query.ts`: `optional` for URL filters, `searchTextSchema`, `containing` and `foldedSql` for search, `paginate` for pages. A form that posts a whole record as JSON reads it with `readPostedJson` (`posted-json.ts`).
- A detail read a ticket touches attaches `allows: Record<action, string | null>`: per action, `null` when allowed or the Spanish reason it's refused, computed for the record and the actor, role included, by the same rule its write refuses with. The load only reads `allows` (to redirect, hide or show the reason), with no status or role checks of its own. Which payment concepts an order offers stays in the payment options' `concepts`, outside `allows`. Orders' and quotes' detail reads get theirs in Phase 29.
- An employee's own resources (their hours punches) are filtered by the actor's employee. An `employee_id` from the client is trusted only from `ADMIN` or `MANAGER`.
- Every write goes through `auditedInsert` / `auditedUpdate`, their statements in one `db.batch()`, so the row and its `events` row never drift apart.
- Zod validates every form and endpoint input on the server, and every JSON on write and on read.
- Nothing is deleted: logins and products are deactivated, employment periods closed, orders cancelled, incidents reversed, movements offset. Only `sessions` rows are deleted.
- Money is whole pesos. Each line is rounded to the peso as it's calculated; a total is the sum of the rounded lines.
- Product prices and names freeze into the order line when added; the client's name and phone into the order when picked; a settlement stores its `settings_snapshot`.
- A `settings` key carries its module as prefix; its module, label, unit and Zod schema live in `src/lib/settings.ts`. Only `ADMIN` and `MANAGER` edit values.
- `cash_movements` and `events` have no edit or delete routes. A correction is an offsetting movement: same concept and link, opposite sign, `reverses_id` pointing to the original, once.
- An order's money in: `SALES`, `MANAGER`, `ADMIN`. Money out, refunds included, and everything recorded in Caja: only `MANAGER` and `ADMIN`. The one exception is `DRIVER`, from Despachos and online only (#605): Pago and deposit from `OUT_FOR_DELIVERY` to `OUT_FOR_PICKUP`; a Cobro por novedad while the order has an active incident, from new money or kept from the deposit (#637); and the whole deposit held back at `OUT_FOR_PICKUP`, incident or not. `CASH` or `TRANSFER` (a charge kept from the deposit has no method), never an offset.
- A public URL never carries an id: it carries a `public_token` from `createPublicToken()` (`src/lib/server/public-token.ts`).
- Warnings never block: no transactions, no inventory reservations, no blocking on overbooking, a minimum amount or a schedule clash.
