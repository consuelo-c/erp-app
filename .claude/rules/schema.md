---
paths:
  - 'src/lib/server/db/schema.ts'
  - 'migrations/**'
---

# Schema rules

- Before launch (the first real order), `migrations/` is squashed freely, carrying the hand-written `events` triggers over by hand. After launch it's append-only.
