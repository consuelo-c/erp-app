---
paths:
  - 'src/**'
---

# Date rules

- Every date and time, display included, is Bogotá's, through `src/lib/datetime.ts`; the device's or browser's zone is never used, and `COMPANY_TIMEZONE` is never written outside that file.
- Today is `getTodaysDate()`, never `new Date().toISOString().slice(0, 10)`; an instant is shown with `formatInstant` and its siblings.
- SQLite's `date('now')` and `datetime('now')` are never used for business logic: the date is computed in JS and passed as a parameter.
- `<input type="date">` values go to the database as-is, never converted to `Date`.
