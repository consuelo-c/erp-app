# erp-app

SvelteKit app for Banquetes Consuelo C, deployed as a Cloudflare Worker. Planning lives in the sibling repository `../planning/` ([`consuelo-c/erp-planning`](https://github.com/consuelo-c/erp-planning)), never copied here. All issues, milestones (`Phase 00`, `Phase 01`, …) and labels live in `consuelo-c/erp-app`: pass `--repo consuelo-c/erp-app` to every `gh` command.

## Always

- **The developer runs every write command** (git add/commit/push, npm install, wrangler create/deploy/apply/secret, gh issue/pr create, gh project item-edit); Claude runs read-only ones, `npm run test`, `lint` and `typecheck` included. When a write command is needed, propose the exact command and wait for the developer to say it ran. Enforced by the deny list in `.claude/settings.json`
- **Language.** Chat, code and docs in English; `README.md` and user-facing UI in Spanish. Issues, issue comments and pull requests in Spanish (title and body); code identifiers, paths, commands and closing keywords stay as they are: `Closes #N`, never `Cierra #N`
- **Scope.** Build what the declared unit needs to work end to end, glue included; a feature or screen another unit or a later phase owns gets a stub, not an implementation
- **No project state here or in Claude Code memory.** The plan lives in `../planning/`, the state in the issues
- **Planning references** are Markdown links: local path as text, GitHub URL as target. Only `hard-rules.md` is imported (below); every other planning file is read through its link when the moment comes, never `@import`ed

## When to read what

All in [../planning/working-methodology.md](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md) (`methodology`) unless named.

- **Opening a session** — `methodology` [§7](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#7-opening-and-closing-a-session): the milestone's open issues, not the planning
- **Opening a phase** — from Phase 03 on, the developer runs `/start-phase NN` (`.claude/skills/start-phase/`); asked to open a phase without it, suggest it. The process stays in `methodology` [Opening a phase](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#opening-a-phase) (screens first, then one issue per unit); the phase's plan is `../planning/phase-NN/planning.md`, read with [../planning/foundations.md](https://github.com/consuelo-c/erp-planning/blob/main/foundations.md)
- **Starting a unit** — `methodology` [The cycle](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#the-cycle) (the branch exists, start working: never ask for the move to `Doing` nor wait on it); the phase's whole criteria file, both halves: `../planning/phase-NN/acceptance.md`
- **Building a screen** — `methodology` [Opening a phase](https://github.com/consuelo-c/erp-planning/blob/main/working-methodology.md#opening-a-phase): only the screens handed off into the session; ask for a missing one of the same phase
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
- `npm run db:seed` — local only: loads `scripts/settings-defaults.sql` (default `settings`, holidays included); idempotent, writes no `events`. `deploy.yml` applies the same file to production
- `npm run db:export` — SQL dump of production to `db-export.sql` (git-ignored)
- `npm run env:create` — creates the D1 database and the R2 bucket; copy the printed IDs into `wrangler.jsonc`
- `npm run build`, `npx wrangler dev` — local run on the Workers runtime

## Folder structure

- `src/routes/` — `/` (the public landing: logo and the icon link to `/login`), `/login`, `/logout` (`POST` only); `+layout.svelte` loads `app.css`; `+error.svelte` is the error screen outside the shell (401, 404, 500). `(app)/` is the shell, a group that keeps the URLs: its `+layout.server.ts` requires a session, `+layout.svelte` holds the bottom bar and the «Más» sheet on a phone, the collapsible sidebar from 1024px, `+error.svelte` shows errors inside it (a 403 names the section and says it isn't theirs). Inside: `/despachos`, where every role lands after login (empty until phase 10), `/horas` (one's own punches: the day tapped in the week, `?dia=`, today by default, above its week; `HoursView.svelte` holds that part) `/horas/empleado`, where `ADMIN` and `MANAGER` land instead (any employee through the selector, `?empleado=`), and `/horas/equipo` (everyone's week, read-only, for the same two), reached from Horas' tabs, `/personal` (Employees: list, `nuevo`, `[id]`), next to `/nomina` in Personal y Nómina's tabs, and `/configuracion` (`ADMIN` and `MANAGER`: the system settings, grouped by module), next to `/configuracion/festivos` and `/logins` (Logins, `ADMIN` only, its tab too: list, `nuevo`, `[id]` with its `contrasena` and `reasignar`) in Sistema's tabs, and `/nomina` (`ADMIN` and `MANAGER`: one employee's weekly settlement, `?empleado=` and `?semana=`, any date of the week, this one by default; `?/guardar` and `?/pagar`, then `PaidSettlement.svelte`, read-only), and `/caja` (`ADMIN` and `MANAGER`: the cash book, filtered through the URL, this month by default: `?desde=`, `?hasta=`, `?tipo=`, `?concepto=`, `?metodo=`, `?empleado=`, `?minimo=`, `?maximo=`, `?texto=`; the filters in a sheet on a phone, under a toggle from 1024px; `?movimiento=` opens a movement's detail over them, its own view on a phone, a side panel from 1024px; `&aviso=registrado` after recording one, its receipt then the primary action), next to `/caja/registrar` in its tabs (a standalone movement in or out, confirmed before saving; `?corrige=` opens it as that movement's offsetting movement, pre-filled, Tipo flipped and locked), and `/caja/comprobante` (a movement's printed recibo de caja or comprobante de egreso, `?movimiento=`, its title by the sign: quarter-letter print CSS, outside the shell through `+page@.svelte`), and `/nomina/comprobante` (a paid settlement's printed receipt, same `?empleado=` and `?semana=`: half-letter print CSS, outside the shell through `+page@.svelte`). Route IDs inside the group carry it: `resolve('/(app)/logins/[id]', …)`
- `src/hooks.server.ts` — resolves the session cookie into `locals.user` (an `Actor`, or null) and slides its expiry
- `src/app.css` — the Design System's tokens as CSS custom properties, its base and text roles (`.meta`, `.note`, `.section-title`), the `.form-stack` / `.chip-row` wrappers and the `.detail-list`
- `src/lib/components/` — the Design System's components translated to Svelte, keeping its BEM class names; only the ones a screen uses so far. Icons are `static/icons.svg`, the system's sprite. `ClockField` is the system's `.clock`: a time typed as hour, minutes and a.m./p.m. `UnsavedChangesGuard` is behavior, not a system component: mounted with a form's id, it asks before leaving with unsaved changes
- `src/lib/datetime.ts` — `getTodaysDate`, `formatInstant`, `formatCivilDate`, `formatClockTime`: Bogotá dates and times; `addDays`, `getWeekStart`, `getMonthRange` and the day, week and period labels (`formatPeriod`): civil-date arithmetic, Monday-to-Sunday weeks; `formatInstantTime`: an instant's Bogotá time; `dialTimeShape`, `toClockTime`, `toDialTime`: a time typed as hour, minutes and a.m./p.m. to and from `HH:MM`
- `src/lib/labels.ts` — `ROLE_LABELS` and the other label maps (`PUNCH_LABELS` included): every enum value reaches the screen through one
- `src/lib/navigation.ts` — `DESTINATIONS`, the same menu for every login (no `href` until a phase builds its screens), `findDestination`, and Personal y Nómina's, Horas', Sistema's and Caja's tabs (a tab's `shortLabel` is what a phone shows)
- `src/lib/format.ts` — `formatPesos`, `formatInteger`, `formatIdNumber`, `formatHours`, `formatReceiptNumber`, `formatSignedPesos`: Colombian number display; `formatPesosInWords`, the only amount in words every receipt prints
- `src/lib/server/actor.ts` — `Actor` and the permission helpers (`requireRole`, `hasAnyRole`, …)
- `src/lib/server/db/schema.ts` — Drizzle schema, source of `migrations/`
- `src/lib/server/password.ts` — `hashPassword` / `verifyPassword` / `needsRehash`: PBKDF2-SHA512 over the peppered password
- `src/lib/server/audit.ts` — `auditedInsert` / `auditedUpdate`: audit columns from the `Actor` plus the `events` row, as statements for one `db.batch()`
- `src/lib/server/timeline.ts` — `filterTimelineForActor`: which `events` rows of an order's timeline each role sees, money stripped for `WAREHOUSE`/`DRIVER`
- `src/lib/server/overtime.ts` — `deriveOvertime`: a day's punches to the five overtime rows, in minutes; `countWorkedMinutes`, the hours the screens show. Pure; the caller passes the holiday flag and the settings values
- `src/lib/payroll.ts` — `calculateSettlement`: the week's nine earnings, four deductions and totals, each line rounded to the peso, the contribution base without transport allowance or bonus; `deriveRates`, `getExtraHoursRange` (Saturday before to Friday, from `period_start`). Pure; the caller passes the quantities and the settings values. Outside `server/` so the settlement screen recalculates as it's typed; `parseQuantity` / `parsePesos` / `roundToMinute` read the typed text the same way on both sides
- `src/lib/server/services/` — business logic, one file per module; its `README.md` has the service-layer rule. `auth.ts`: login, first administrator, sessions; `cash.ts`: `movementStatements`, the only insert into `cash_movements` for every module, its `receipt_number` worked out per sign by the same `INSERT`, and the movement's Zod schemas; `getCashBook`, the filtered movements and the period's three totals (in, out, net: one `SUM`, no join); `getMovement`, one movement's detail with what it corrects or was corrected with, and the settlement a `PAYROLL` one pays, which its «Ver origen» opens in Nómina; `getReceipt`, that detail plus the company's header from `settings`; `recordMovement`, a standalone `OTHER_INCOME` or `OTHER_EXPENSE` from the entry tab; `recordOffset`, the offsetting movement (same concept and link, opposite amount, `reverses_id`; once, never of a correction), and `getOffsetOriginal`, the movement it pre-fills from; `employees.ts`: employees and their employment periods; `logins.ts`: logins, their roles, passwords, reassignment, deactivation and reactivation; `timesheets.ts`: hours punches, one's own or, for `ADMIN`/`MANAGER`, anyone's and the team's week, a day cleared to null (`CLEARED`) when punched by mistake, locked on the days a `PAID` settlement of that employee covers in its extra-hours range; `settings.ts`: the system settings, each change an event keyed by `entity_key`; `PAYROLL_HOLIDAYS` through its own editor, the dates up to the freeze line (the Friday ending the latest `PAID` settlement's extra hours) changed only by `ADMIN` with a reason, kept in `events.reason`; and `readSettings`, the parsed values the other services calculate with; `payroll.ts`: the weekly settlement draft, recalculated from the hours log and the current settings every time it opens or is saved, written only by saving; recording its payment saves it, marks it `PAID` (frozen) and writes its `PAYROLL` row in `cash_movements` through `cash.ts` (linked by `entity_type` `PAYROLL_RUN` + `entity_id`, the method's details in `attributes`), in one batch
- `src/lib/server/session-cookie.ts` — the session cookie's name and flags
- `src/lib/server/chosen-employee.ts` — `rememberEmployee`: the employee last picked in Horas › Empleado or Nómina, in a cookie, so moving between the two keeps the same person
- `src/lib/server/db/memory-d1.ts` — tests only: a D1 stand-in over `node:sqlite` with every migration applied
- `src/lib/settings.ts` — `SETTINGS`: each key's module, Spanish label, unit, placeholder and Zod schema (parses the stored `value` TEXT); `getSettingInput`: how the screen takes it
- `src/service-worker.ts` — PWA shell cache; `static/` — app icons, the icon sprite and `manifest.json`
- `migrations/` — generated SQL; squashed freely until launch, append-only after
- `scripts/` — `wipe-d1-if-squashed.js`: the deploy's pre-launch production wipe; `settings-defaults.sql`: default `settings`, applied locally by `db:seed` and to production by the deploy
- `.github/workflows/` — `verify.yml` (PRs), `deploy.yml` (merge to `main`)
- `.husky/` — `pre-commit`, `commit-msg`; `.claude/settings.json` — plan mode and the deny list; `.claude/skills/` — `start-phase`

## Hard rules

Imported from the planning, so they are always current. Cited by name, not by number.

@../planning/hard-rules.md
