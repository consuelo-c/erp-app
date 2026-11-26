---
paths:
  - 'src/lib/server/db/schema.ts'
  - 'migrations/**'
---

# Schema rules

- `migrations/` is append-only: the app launched on November 23, 2026. A schema change is a new migration, never an edit to or a squash of an existing one.
