---
paths:
  - 'src/lib/server/db/schema.ts'
  - 'migrations/**'
---

# Schema rules

- The app is launched (see **Launch** in `GLOSSARY.md`): `migrations/` is append-only. Never edit, delete or squash a migration already in it.
- A migration that drops a column or a table, or runs `DELETE`, needs the developer's explicit approval in its ticket.
- A table recreation (drizzle's `__new_` copy, for example to add a CHECK) must copy every row; for `events`, it must also re-add the hand-written triggers that abort UPDATE and DELETE.
