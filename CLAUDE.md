# erp-app

SvelteKit app for Banquetes Consuelo C, a party rental business in Medellín, deployed as a Cloudflare Worker. Planning lives in the sibling repository `../planning/` ([`consuelo-c/erp-planning`](https://github.com/consuelo-c/erp-planning)), never copied here; the screens are exported from the [Design Project](https://claude.ai/design/p/006ed22e-09bb-4114-a78f-4fe4d654254e) to `../design/`, outside every repository. All issues, milestones (`Phase 00`, `Phase 01`, …) and labels live in `consuelo-c/erp-app`: pass `--repo consuelo-c/erp-app` to every `gh` command.

## Always

- **The developer runs every write command** (git add/commit/push, npm install, wrangler create/deploy/apply/secret, gh issue/pr create, gh project item-edit); Claude runs read-only ones, `npm run test`, `lint` and `typecheck` included. When a write command is needed, propose the exact command and wait for the developer to say it ran. Enforced by the deny list in `.claude/settings.json`
- **Language.** Chat, code and docs in English; `README.md` and user-facing UI in Spanish. Issues, issue comments and pull requests in Spanish (title and body); code identifiers, paths, commands and closing keywords stay as they are: `Closes #N`, never `Cierra #N`
- **Scope.** Build what the declared unit needs to work end to end, glue included; a feature or screen another unit or a later phase owns gets a stub, not an implementation
- **No project state here or in Claude Code memory.** The plan lives in `../planning/`, the state in the issues
- **Search** with `rg` and `fd`, never `grep` or `find`
- **Planning references** are Markdown links: local path as text, GitHub URL as target. Only `hard-rules.md` is imported (below); every other planning file is read through its link when the moment comes, never `@import`ed

## When to read what

All in [../planning/working-methodology.md](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md) (`methodology`) unless named.

- **Opening a session** — `methodology` [§7](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#7-opening-and-closing-a-session): the milestone's open issues, not the planning
- **Opening a phase** — the developer runs `/start-phase NN` (`.claude/skills/start-phase/`); asked to open a phase without it, suggest it. The process stays in `methodology` [Opening a phase](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#opening-a-phase) (screens first, then one issue per unit); the phase's plan is `../planning/phase-NN/planning.md`, read with [../planning/foundations.md](https://github.com/consuelo-c/erp-planning/blob/main/foundations.md)
- **Starting a unit** — `methodology` [The cycle](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#the-cycle) (the branch exists, start working: never ask for the move to `Doing` nor wait on it); the phase's whole criteria file, both halves: `../planning/phase-NN/acceptance.md`
- **Building a screen** — `methodology` [Opening a phase](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#opening-a-phase): only the files in `../design/` of the screens its issue names; ask before reading another of the same phase
- **Needing something another unit or phase owns** — `methodology` [Stubs are the way out](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#stubs-are-the-way-out)
- **Finding a gap, ambiguity, error or contradiction in the planning** — `methodology` [Gaps in the planning](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#gaps-in-the-planning) and [§4](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#4-the-issues)
- **Writing code** — `methodology` [§13 Code standards](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#13-code-standards)
- **Creating an issue** — `methodology` [§4](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#4-the-issues)
- **Closing a unit** — `methodology` [§3 Commits](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#3-commits)
- **Closing a session** — `methodology` [§7](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#7-opening-and-closing-a-session)
- **Closing a phase** — `methodology` [§9](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#9-closing-a-phase)
- **Using a skill that reviews or trims code (ponytail)** — `methodology` [§10](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#10-the-skills): the planning wins over the skill

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
- `npm run db:seed` — local only: `scripts/settings-defaults.sql` (default `settings`, the only part `deploy.yml` applies to production), then `scripts/sample-data.sql` (its header says what it holds: October 2026, read as if today were the 14th; the `gerente`, `representante`, `bodega` and `conductor` logins have no password until admin sets one); idempotent, writes no `events`
- `npm run db:export` — SQL dump of production to `db-export.sql` (git-ignored)
- `npm run env:create` — creates the D1 database and the R2 bucket; copy the printed IDs into `wrangler.jsonc`
- `npm run build`, `npx wrangler dev` — local run on the Workers runtime

## Folder structure

Where things live and which helper to reuse. What a screen or service does is read in its code, or in the phase's `planning.md` before extending it.

- `src/routes/` — the public pages: `/` (landing and the client's lookup), `/login`, `/logout`, `/sesion` (the shell's session JSON), `/mi-pedido/[token]` (the client's page). `(app)/` is the shell, session required, one folder per destination in `DESTINATIONS`; route IDs inside carry the group: `resolve('/(app)/logins/[id]', …)`. Printouts render outside the shell through `+page@.svelte`
- `src/hooks.server.ts` — the session cookie into `locals.user` (an `Actor`, or null), sliding its expiry; the public pages' no-referrer, no-index, no-store headers
- `src/app.css` — the Design System's tokens, base and text roles, and the layout wrappers (`.form-stack`, `.chip-row`, `.detail-list`, `.screen__action`)
- `src/lib/components/` — the Design System's components in Svelte, keeping its BEM class names; only the ones a screen uses. Icons are `static/icons.svg`, the system's sprite
- `src/lib/*.ts` — pure, outside `server/` so forms recalculate as they're typed:
  - `datetime.ts` — every Bogotá date and time: `getTodaysDate`, formatting, Monday-to-Sunday week and month arithmetic, the typed a.m./p.m. clock
  - `phone.ts` — `normalizePhone`, the only normalizer, on save; `formatPhone`
  - `format.ts` — pesos, numbers, receipt numbers, `formatPesosInWords`; `fold`, accents and case off, for every search
  - `labels.ts` — every enum value's Spanish label
  - `navigation.ts` — `DESTINATIONS` (one menu for every login) and each section's tabs; `getPageNumbers`
  - `settings.ts` — `SETTINGS`: each key's module, label, unit and Zod schema
  - `orders.ts` — `calculateOrderTotals`; `isLegalTransition`, the only rule for status changes; `nextOperationalStatus`, `isEditableStatus`, `isIncidentReportable`
  - `payroll.ts` — `calculateSettlement`, `deriveRates`, and the typed-text parsers both sides share
  - `offline.ts` — Despachos' offline copy: `fetchJson`, `readDispatchCache` (its only reader), `clearDispatchCache`
- `src/lib/server/` — `actor.ts` (`Actor`, `requireRole`, `hasAnyRole`); `audit.ts` (`auditedInsert` / `auditedUpdate`: audit columns and the `events` row, as statements for one `db.batch()`); `password.ts`; `session-cookie.ts`; `markdown.ts` (`renderHelp` and `renderTerms`, the only HTML `{@html}` takes); `turnstile.ts`; `overtime.ts` (`deriveOvertime`); `order-changes.ts` (an edit's diff); `timeline.ts` (which events each role sees); `list-filters.ts` (lists' filters kept in a cookie); `chosen-employee.ts`
- `src/lib/server/services/` — business logic, one file per module; its `README.md` has the rule. The only rules for what they name: `cash.ts`' `movementStatements` (every insert into `cash_movements`), `orders.ts`' `getAvailability` and `MODIFIED_AFTER_STAGING_AT`, `inventory.ts`' `isStale`, `reversalBlock` and `getUnitsOnRent`. `public-orders.ts` is the client's side: no actor, no writes
- `src/lib/server/db/` — `schema.ts`, Drizzle, source of `migrations/`; `memory-d1.ts`, the tests' D1 over `node:sqlite`
- `src/service-worker.ts` — the PWA shell cache, never a data response (hence `paths.relative: false`)
- `migrations/` — generated SQL; squashed freely until launch, append-only after
- `scripts/` — `settings-defaults.sql`, `sample-data.sql`, `wipe-d1-if-squashed.js` (the deploy's pre-launch wipe)
- `.github/workflows/` — `verify.yml` (PRs), `deploy.yml` (merge to `main`); `.husky/` — `pre-commit`, `commit-msg`; `.claude/` — the deny list and the `start-phase` skill

## Hard rules

Imported from the planning, so they are always current. Cited by name, not by number.

@../planning/hard-rules.md
