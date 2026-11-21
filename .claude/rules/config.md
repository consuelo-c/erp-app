---
paths:
  - 'wrangler.jsonc'
---

# Config rules

- Identifiers come from the CLI's output or `wrangler d1 info`, never from memory; after editing, run `wrangler types` (`npm run typecheck` does).
- The file stores identity (`account_id`, `database_id`, names), never access: secrets go to `wrangler secret`, `.dev.vars` or GitHub Secrets.
- R2 is never public: no public URL, no domain on the bucket.
