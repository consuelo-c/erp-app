---
paths:
  - '**/*.test.ts'
---

# Test rules

- Tests build their rows with `createFixture` (`src/lib/server/db/fixture.ts`): its builders write through the real services, so every row has the audit columns and `events` row a real save leaves. Pass only the fields the test reads; the builders fill in the rest.
- Actors are the fixture's constants (`ADMIN`, `MANAGER`, `SALES`, `WAREHOUSE`, `DRIVER`) or `actorWith(...roles)`; one that needs a real employee comes from `employee({ roles })`. No actor literals, no made-up `employeeId`.
- Only `migrations.test.ts` writes raw SQL: no `insert into`, no `AUDIT` literal, no local contact or product inserter, no quote or order with hand-written JSON.
- Script tests (`audit`, `settings-defaults`, `catalog`, `sample-data`) run their script on bare `createMemoryD1()`.
- A row no service can write (an old row shape, a schema constraint check) is tested in `migrations.test.ts`, read back through the real service where the test reads it; any other state no service can produce is raised on the spec or issue, not built with raw SQL.
