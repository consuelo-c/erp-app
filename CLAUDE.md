# erp-app

SvelteKit app for Banquetes Consuelo C, deployed as a Cloudflare Worker.

## Stack

- SvelteKit 2 + Svelte 5, TypeScript, `adapter-cloudflare` (Workers), configured in `vite.config.ts`
- D1 (binding `DB`) and R2 (binding `BUCKET`), declared in `wrangler.jsonc`. A single environment: `main` is production
- Drizzle is only used to generate migrations (`src/lib/server/db/schema.ts` → `migrations/`); they are applied with `wrangler d1 migrations apply`
- Vitest (unit, node), ESLint, Prettier, Stylelint; husky runs gitleaks, lint-staged and commitlint

## Commands

Claude runs `test`, `lint` and `typecheck`; the developer runs every other one.

- `npm install` — dependencies only enter through `npm install` / `npm install -D`, never by editing `package.json`
- `npm run dev` — Vite dev server
- `npm run test` — unit tests, once (Claude runs this); `npm run test:watch` re-runs them on save
- `npm run lint` — `lint:js` (ESLint) and `lint:css` (Stylelint) in parallel
- `npm run format` — `format:css` (Stylelint `--fix`), then `format:js` (Prettier)
- `npm run typecheck` — `wrangler types`, `svelte-kit sync` and `svelte-check` over the whole project
- `npm run db:generate` — new migration from the schema
- `npx wrangler d1 migrations apply consueloc-erp-db --local` — apply migrations locally; remote is applied only by `deploy.yml`
- `npm run db:reset` — local only: deletes the on-disk D1, applies every migration and runs the seed
- `npm run db:seed` — local only: loads `scripts/settings-defaults.sql` (default `settings`, holidays included); idempotent, writes no `events`. `deploy.yml` applies the same file to production
- `npm run db:export` — SQL dump of production to `db-export.sql` (git-ignored)
- `npm run env:create` — creates the D1 database and the R2 bucket; copy the printed IDs into `wrangler.jsonc`
- `npm run build`, `npx wrangler dev` — local run on the Workers runtime

## Folder structure

- `src/routes/` — only `/`, a stub that phase 3 replaces
- `src/lib/server/db/schema.ts` — Drizzle schema, source of `migrations/`
- `src/lib/server/audit.ts` — `auditedInsert` / `auditedUpdate`: audit columns from the `Actor` plus the `events` row, as statements for one `db.batch()`
- `src/lib/server/timeline.ts` — `filterTimelineForActor`: which `events` rows of an order's timeline each role sees, money stripped for `WAREHOUSE`/`DRIVER`
- `src/lib/server/services/` — business logic, one file per module; its `README.md` has the service-layer rule
- `src/lib/settings.ts` — `SETTINGS`: each key's module, Spanish label, unit and Zod schema (parses the stored `value` TEXT)
- `src/service-worker.ts` — PWA shell cache; `static/` — icons and `manifest.json`
- `migrations/` — generated SQL; squashed freely until launch, append-only after
- `scripts/` — `wipe-d1-if-squashed.js`: the deploy's pre-launch production wipe; `settings-defaults.sql`: default `settings`, applied locally by `db:seed` and to production by the deploy
- `.github/workflows/` — `verify.yml` (PRs), `deploy.yml` (merge to `main`)
- `.husky/` — `pre-commit`, `commit-msg`; `.claude/settings.json` — plan mode and the deny list

## Workflow

- **Who runs what.** The developer runs every write command (git add/commit/push, npm install, wrangler create/deploy/apply, gh issue/pr create, gh project item-edit); Claude runs read-only ones, `npm run test` included. The deny list is in `.claude/settings.json`. When a write command is needed, Claude proposes the exact command and waits for the developer to say it ran
- **Closing a unit.** Run `npm run lint` and fix every error, review the diff against [../planning/07-Working-Methodology.md §13 Code standards](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#13-code-standards) (read it before writing code), propose a Conventional Commit with a Spanish description, and ask the developer to say when it's done
- **Deploys are not manual.** Production deploys on merge to `main` (`.github/workflows/deploy.yml`). A manual `wrangler deploy` is only for debugging a specific problem. `verify.yml` runs on PRs; its `test` job is the required check
- **Short branches.** One per unit of work, not per phase: `<type>/<issue>-<slug>` (`feat/42-timesheets-table`). Always a pull request whose body closes the issue with `Closes #42`; `main` is protected
- **Opening a session.** Read the milestone's open issues (`gh issue list --repo consuelo-c/erp-app --milestone "Phase NN" --state open`) instead of re-reading the planning for open items. Move the issue to `Doing` with the command in [../planning/07-Working-Methodology.md#the-cycle](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#the-cycle); if it fails or its `--id` comes out empty, ask the developer to move it by hand on the board
- **Open items go to issues, not to the chat.** On closing a session, every open item found gets a `gh issue create --repo consuelo-c/erp-app` command with a type (`Task`, `Bug`, `Feature`), the `docs` or `debt` label if applicable (the only labels), and the milestone of the phase it blocks. Manual-action issues carry the exact command in the body. Never set a priority: only the developer does, and only on `Bug` and `Feature` ([../planning/07-Working-Methodology.md §4](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#priority))
- **Language.** Chat, code and docs in English; `README.md` and user-facing UI in Spanish. Issues, issue comments and pull requests in Spanish (title and body); code identifiers, paths, commands and closing keywords inside them stay as they are: `Closes #N`, never `Cierra #N`
- **Errors in the documents are reported, not fixed.** Create a `docs` issue and move on. A contradiction or gap in the planning: stop and ask first; almost everything odd is deliberate
- **Scope.** Work only on the unit declared at the start of the session, not even trivial things from other units or "while we're here". Anything needed from another phase: a `Task` issue in that phase's milestone, or a stub
- **Stubs.** A `STUB: phase N replaces this with …` comment and a `debt` issue in that phase's milestone. An unmarked stub passes for finished work, which is worse than not having it. Never delete an existing stub outside the phase that replaces it
- **Identity, not access.** `wrangler.jsonc` holds `account_id`, `database_id` and names, never access; identifiers come from `wrangler whoami` / `wrangler d1 info`, asked of the developer, never invented. Secrets go to GitHub Secrets, `wrangler secret`, `.dev.vars` or `.env.local`; `.env.example` lists keys only
- **Everything is logged.** Every service-layer write writes an `events` row, plus login, failed login and logout. `events` is append-only: no updates, no deletes, not even by `ADMIN`
- **No project state in Claude Code memory.** The plan lives in `../planning/`, the state in the issues

## Hard rules

Copied in full from [../planning/02-planning/hard-rules.md](https://github.com/consuelo-c/erp-planning/blob/main/02-planning/hard-rules.md). Cited by name, not by number.

### Architecture

- Business logic lives in `src/lib/server/services/`. SvelteKit routes only resolve the actor, invoke the service, and render.
- Services take `(input, actor)` and know nothing about transport: no cookies, no `locals`, no `Request`.
- `requireRole` takes a **resolved actor**, never `locals`.
- Audit columns are always filled from `actor.username`, in a common layer, not in each endpoint.

### Naming

- Code, columns, and enum values in **English**. Documents in **English**, UI in **Spanish**.
- No raw enum value ever reaches the screen: everything goes through the label maps.

### Data

- Money is always `INTEGER`, **whole pesos**, never `REAL`, never cents. Each line rounds to the peso as it's calculated; totals are the sum of the rounded lines.
- Every JSON is validated with **Zod** on write and on read, and **every form or endpoint input is validated with Zod on the server**. SQLite validates nothing.
- Nothing is deleted: logins and products get deactivated, employees get their employment period closed, orders get cancelled, incidents get reversed, movements get offset.
- Prices and names **freeze** into the order when it's created; settlement stores `settings_snapshot` with the values used.
- An incident adjusts inventory **only** for products with `outcome` `LOST` or `UNRECOVERABLE`.
- Inventory, incidents, and counts operate on the **variant**, not the group. Variants have no parent row.
- `settings` stores **one current value** per key, no date-based versions. Keys carry a module prefix; module, label, unit, and schema live in `src/lib/settings.ts`, not in a column. Only `ADMIN` and `MANAGER` edit values — `PAYROLL_HOLIDAYS` included, subject to its own freeze ([../planning/02-planning/payroll.md#freeze](https://github.com/consuelo-c/erp-planning/blob/main/02-planning/payroll.md#freeze)).
- Every write through the service layer also writes an `events` row: append-only, `before`/`after` on changes, no updates or deletes ever ([../planning/02-planning/foundations.md#the-events-table](https://github.com/consuelo-c/erp-planning/blob/main/02-planning/foundations.md#the-events-table)).

### Dates

- `new Date().toISOString().slice(0,10)` is forbidden. Use `getTodaysDate()`.
- SQLite's `date('now')` / `datetime('now')` are forbidden for business logic.
- Every date and time, display included, is Bogotá's. The device's or browser's zone is never used.
- `<input type="date">` values go to the database as-is, never converted to `Date`.

### Security

- `requireRole(actor, [...])` as the first line of every endpoint and every server `load`, except the public ones (`/`, `/login`, the client lookup).
- Permissions are **multi-role**: use `hasAnyRole()`, never a direct comparison.
- **Resource ownership (anti-IDOR):** when a resource belongs to a user — like their hours punches — the query filters by the authenticated actor's employee. An `employee_id` coming from the client is never trusted, except when the actor is `ADMIN` or `MANAGER` using the dropdown.
- The order's public URL uses `public_token`, never the `id`. The token is generated with **`crypto.randomUUID()`** or at least 16 bytes from `crypto.getRandomValues()`; never `Math.random()`.
- The session lasts **30 days** (initial `expires_at`) with sliding expiration. The table stores the token's SHA-256, never the token.
- **Don't disable SvelteKit's `checkOrigin`** (its CSRF protection). Don't configure `csrf: { checkOrigin: false }`.
- **Login rate limiting isn't implemented in code**: it's configured on Cloudflare (WAF / platform rate limiting). The public lookup's, if that phase is approved, does go in code.
- **R2 is never public.** Photos are uploaded through the Worker with `requireRole` (image MIME, 5 MB max) and served through an authenticated endpoint that streams from the bucket. No public URLs, no open buckets. Retention under `incidents/` is handled with a **365-day lifecycle rule**, not code.
- **The sample-data seed only runs in development.** The first administrator is created by the Worker from the `ADMIN_PASSWORD` secret when `users` is empty; **no literal password in the repository**. Passwords are hashed with PBKDF2-SHA512 and a `PASSWORD_PEPPER` that lives only in the Worker's secrets ([../planning/02-planning/access.md#passwords](https://github.com/consuelo-c/erp-planning/blob/main/02-planning/access.md#passwords)).
- **Operational** transitions aren't role-restricted, but require a valid session and a legal transition. Only **commercial** ones carry a role lock.
- A transition's validity depends on the current state **and on `delivery_method` / `return_method`**. A single function decides it.

### Payroll and hours

- The receipt's hours quantities **are derived from the hours log** ([../planning/02-planning/payroll.md#overtime-derivation](https://github.com/consuelo-c/erp-planning/blob/main/02-planning/payroll.md#overtime-derivation)) and the manager can correct them before settling.
- Surcharge factors, the workday, the days divisor, and the night-shift cutoff hour are **`settings` parameters**, never constants.
- On a Sunday or holiday, **the 7-hour cutoff doesn't apply**: all hours go to the holiday rows.
- The Sunday surcharge and the holiday surcharge are **a single concept with a single percentage**.
- The contribution base (IBC) **excludes the transport allowance and the non-salary bonus**.
- The employer contribution **isn't calculated in the app**: suaporte settles it. Only the monthly outflow is recorded.
- `timesheets` **has no payment fields**: the lock derives from the `PAID` settlement.
- A settlement freezes **when the payment is recorded**, not when it's printed. Freezing also advances the holiday freeze line ([../planning/02-planning/payroll.md#freeze](https://github.com/consuelo-c/erp-planning/blob/main/02-planning/payroll.md#freeze)).

### Cash

- All money goes to `cash_movements`. The sign indicates the direction; there's no "inflow/outflow" column.
- A movement's links are **typed, nullable foreign keys**, never `subject_type` + `subject_id`.
- There are no edit or delete routes for `cash_movements` or `events`. The correction is an offsetting movement.
- The driver **doesn't record payments**: they leave notes on the order. The movement is recorded when the money reaches the office.
- The cash book **doesn't reconcile cash**: no opening balance, no tracking of who holds the money.
- No per-employee loan balance is kept: it's typed in every week.

### Things that must NOT be built

- No transactions or inventory reservations, and no validation that blocks for overbooking, a minimum amount, or a schedule clash: **warnings never block**.
- No VAT, no tax fields.
- No email password recovery, no dark theme.
- No carrier table: `carrier_name` and `carrier_phone` are free text on the order.
- What the company pays the external carrier is a `CARRIER_PAYMENT` outflow in `cash_movements`, never subtracted from the order total.
- The system **doesn't decide** whether the deposit is withheld: it only records who's responsible and the outcome.
- **No "repaired" action** on a recoverable incident. The partial count resolves it. Overlapping counts warn, they don't block; the last approval wins.
- Offline mode is **read-only**: no queue, no retries, no loop checking for signal. The cache is saved with its date; if it isn't today's, it isn't shown.
- Printing is done with CSS (`@page`), **not a PDF library**.
- Route `/` is the public landing page, reserved for the client lookup — not login.
- This application's prices win over any incoming order's.
- **Nothing MCP or webhook-related exists yet**: only the transport/service separation from [../planning/02-planning/foundations.md#architecture-service-layer-and-resolved-actor](https://github.com/consuelo-c/erp-planning/blob/main/02-planning/foundations.md#architecture-service-layer-and-resolved-actor) is respected. No transport contains business logic.

### CI/CD, branches, and environment

- **There's a single deployed environment.** No staging exists: one D1, one R2, one Worker. `main` is production.
- Development goes through **short branches, one per unit of work and its issue** (`feat/42-timesheets-table`), merged to `main` by a pull request that closes the issue. `main` is protected against direct push.
- The token that authenticates the workflow against Cloudflare lives in **GitHub Secrets**, never in `wrangler secret` or the repository, and has scoped permissions — never the global account token.
- The deploy workflow runs Vitest before deploying; if the tests fail, it never reaches migrations or `wrangler deploy`. Manual `wrangler deploy` isn't the normal flow.
- Before launch (the first real order), migrations are squashed freely and the deploy wipes production when they no longer match — **only if `orders` is missing or empty**; otherwise it fails. After launch, `migrations/` is append-only.
- **Tests block, linting doesn't.** ESLint and Stylelint run on the pull request with `continue-on-error`.

### Tools and execution

- The package manager is **npm**. `package.json` isn't hand-edited except the `scripts` block: dependencies come in via `npm install` and `npm install -D`.
- `wrangler.jsonc` identifiers come from the CLI's output or from `wrangler d1 info`, never from memory. Resources are created via the CLI, never from the web dashboard. After editing the file, `wrangler types` is run.
- **Write commands are run by the developer.** Claude Code runs the read-only ones, `npm run test` included, and proposes the rest.
- Every commit follows **Conventional Commits**; commitlint validates it in the `commit-msg` hook.

### Scope and secrets

- **No work gets done ahead of schedule**, from other units or later phases. Whatever's needed and belongs to another phase gets resolved with a stub and an issue.
- Every stub carries a `STUB:` comment naming the phase that replaces it, and an issue with the `debt` label in that phase's milestone.
- `wrangler.jsonc` stores **identity** (`account_id`, `database_id`, names), never **access**. Secrets go to GitHub Secrets, `wrangler secret`, `.dev.vars`, or `.env.local`.
- The pre-commit hook runs **Gitleaks** on the staged files.

## Planning

Planning lives in the sibling repository `../planning/` ([`consuelo-c/erp-planning`](https://github.com/consuelo-c/erp-planning)) and is never copied here. All issues, milestones (`Phase 00` to `Phase 12`) and labels live in `consuelo-c/erp-app`. Start at [../planning/07-Working-Methodology.md](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md).

References to planning files are Markdown links with the local path as text and the GitHub URL as target, e.g. [../planning/02-planning/payroll.md](https://github.com/consuelo-c/erp-planning/blob/main/02-planning/payroll.md). Never `@import` them: they would load into every session.
