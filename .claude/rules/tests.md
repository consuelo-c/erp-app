---
paths:
  - '**/*.test.ts'
---

# Test rules

These cover tests on the memory D1. Tests that never touch it (pure ones like `actor.test.ts` and `timeline.test.ts`, route tests run with `platform: undefined`, component tests) are outside them.

- Tests build their rows with `createFixture` (`src/lib/server/db/fixture.ts`): its builders write through the real services, so every row has the audit columns and `events` row a real save leaves. Pass only the fields the test reads; the builders fill in the rest.
- Actors are the fixture's constants (`ADMIN`, `MANAGER`, `SALES`, `WAREHOUSE`, `DRIVER`) or `actorWith(...roles)`; one that needs a real employee comes from `employee({ roles })`. No actor literals, no made-up `employeeId`.
- Only `migrations.test.ts` and the script tests below write raw SQL: no `insert into`, no `AUDIT` literal, no local contact or product inserter, no quote or order with hand-written JSON.
- Script tests (`settings-defaults`, `catalog`, `sample-data`) run their script on bare `createMemoryD1()`, with the raw SQL that checks it (an `update` proving a re-run leaves edited rows alone). `audit.test.ts` may write its synthetic `sample_rows` table, which no service writes.
- A row no service can write (an old row shape, a schema constraint check) is tested in `migrations.test.ts`, read back through the real service where the test reads it; any other state no service can produce is raised on the spec or issue, not built with raw SQL.
