# services

All business logic lives here, one file per module (`orders.ts`, `payroll.ts`, …). None is implemented yet: each phase adds its own.

The rule, from [../planning/02-planning/foundations.md](https://github.com/consuelo-c/erp-planning/blob/main/02-planning/foundations.md#architecture-service-layer-and-resolved-actor):

- A service takes `(input, actor)` and knows nothing about transport: no cookies, no `locals`, no `Request`. The same function serves a SvelteKit route today and an MCP server or a webhook tomorrow.
- Routes are a thin transport: they resolve the `Actor`, call the service and render. They don't compute totals, validate dates or decide state transitions.
- The service checks permissions with `requireRole(actor, [...])` and validates its input with Zod.
- Every write goes through `auditedInsert` / `auditedUpdate` (`../audit.ts`), and their statements run in a single `db.batch()`, so the row and its `events` row can't drift apart.
