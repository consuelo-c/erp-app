# services

All business logic lives here, one file per module (`orders.ts`, `payroll.ts`, …).

The rule (with the rest in [`.claude/rules/server.md`](../../../../.claude/rules/server.md)):

- A service takes `(input, actor)` and knows nothing about transport: no cookies, no `locals`, no `Request`. The same function serves a SvelteKit route today and an MCP server or a webhook tomorrow.
- Routes are a thin transport: they resolve the `Actor`, call the service and render. They don't compute totals, validate dates or decide state transitions.
- The service checks permissions with `requireRole(actor, POLICIES.<key>)` on its own key (a route may guard with a narrower one), and validates its input with Zod.
- `requireRole` is its only throw: a read returns `null` for a missing record (or `{ missing: … }` where the page tells cases apart), a write refuses it with `messageRefusal('… no existe')`, and a refusal is a `SaveResult` refusal from `../result.ts`; the route turns them into 404 and `fail(400)`.
- Lists use `../query.ts` (`optional`, `searchTextSchema`, `containing`, `foldedSql`, `paginate`).
- A detail read a ticket touches returns `allows`, each action's `null` or Spanish refusal, by the same rule its write refuses with.
- Every write goes through `auditedInsert` / `auditedUpdate` (`../audit.ts`), and their statements run in a single `db.batch()`, so the row and its `events` row can't drift apart.
