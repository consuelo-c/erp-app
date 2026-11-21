# erp-app

SvelteKit app for Banquetes Consuelo C, a party rental business in Medellín, deployed as a Cloudflare Worker. Planning lives in the sibling repository [`consuelo-c/erp-planning`](https://github.com/consuelo-c/erp-planning), never copied here, and the brand in [`consuelo-c/branding`](https://github.com/consuelo-c/branding); find a repository's folder by its remote (`git -C <folder> remote get-url origin`); the screens live in the [canvas](https://claude.ai/artifact/TBE5f1FaBxQJxkKwncJspg), a Claude artifact read and published to with the Artifact tool (the only artifact Claude publishes to, only to the pages its work names, saying which pages it changed); its terms (page, component page, frame) are in [`GLOSSARY.md`](GLOSSARY.md). All issues, milestones (`Phase 00`, `Phase 01`, …) and labels live in `consuelo-c/erp-app`: pass `--repo consuelo-c/erp-app` to every `gh` command.

## Always

- **Claude takes the work from a branch to a green pull request; the developer merges.** Claude branches, commits, pushes, creates issues and pull requests, and runs `npm run test`, `lint`, `typecheck` and `db:generate`: exactly the `allow` list in `.claude/settings.json`. Never `gh pr merge`, a force push, a push to `main`, or deleting an issue (the `deny` list). npm install, wrangler writes, `db:reset`, priorities and board moves stay the developer's: propose the exact command and wait for the developer to say it ran. Issue bodies are written out in full, never compressed by a skill
- **Language.** Everything in English: chat, code, docs, `README.md`, issues, comments, specs, pull requests and commits. Spanish only in the app's user-facing UI. Closed issues and old pull requests stay as they are
- **Scope.** Build what the ticket needs to work end to end, glue included; a feature or screen another ticket or a later phase owns gets a stub, not an implementation
- **No project state here or in Claude Code memory.** The plan and the state live in the issues: maps, specs and tickets. `erp-planning` holds the frozen phases and the planning not yet moved here
- **Search** with `rg` and `fd`, never `grep` or `find`
- **Planning references** are Markdown links: repository and path as text (`` `erp-planning:phase-06/planning.md` ``), GitHub URL as target; never a folder name. Planning files are read through their link when the moment comes, never `@import`ed

## When to read what

- **Sessions** — every one is launched with `claude --permission-mode auto` (project settings can't turn it on; without it, `defaultMode` is `default` and a startup hook warns); planning sessions (`/wayfinder`, `/to-spec`, `/to-tickets`) also turn ponytail off with `--settings '{"enabledPlugins":{"ponytail@ponytail":false}}'`. Grilling asks with AskUserQuestion, one question per call, the recommended option first. `erp-planning` is read-only: the guard hook denies any write there
- **Building a phase** — the workflow in [Agent skills](#agent-skills): `/wayfinder` → `/to-spec` → `/to-tickets` → `/implement-spec`. Asked to build a phase any other way, suggest it
- **Starting a ticket** — its spec (the parent issue) and the decisions on the phase map; extending a frozen phase's code, its `erp-planning:phase-NN/planning.md` (the phase found through its `Phase NN` milestone), after the code
- **Building a screen** — only the canvas pages (`project/<page>`, read with the Artifact tool) of the screens its issue names; ask before reading another of the same phase (in an `/implement-spec` run, build without it and say so)
- **Finding a gap, ambiguity, error or contradiction in the planning** — in an `/implement-spec` run, see [Agent skills](#agent-skills); otherwise ask the developer
- **Creating an issue** — [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)

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
- `npm run db:seed` — local only: `scripts/settings-defaults.sql` (default `settings`, the only part `deploy.yml` applies to production), then `scripts/catalog.sql` (the real catalog, run once by hand on production), then `scripts/sample-data.sql` (its header says what it holds: October 2026, read as if today were the 14th; the `gerente`, `representante`, `bodega` and `conductor` logins have no password until admin sets one); idempotent, writes no `events`
- `npm run db:export` — SQL dump of production to `db-export.sql` (git-ignored)
- `npm run env:create` — creates the D1 database and the R2 bucket; copy the printed IDs into `wrangler.jsonc`
- `npm run build`, `npx wrangler dev` — local run on the Workers runtime

## Folder structure

Where things live and which helper to reuse. What a screen or service does is read in its code, or in the phase's `planning.md` before extending it.

- `src/routes/` — the public pages: `/` (landing and the client's lookup), `/login`, `/logout`, `/sesion` (the shell's session JSON), `/mi-pedido/[token]` (the client's page). `(app)/` is the shell, session required, one folder per section of the menu; route IDs inside carry the group: `resolve('/(app)/logins/[id]', …)`. Printouts render outside the shell through `+page@.svelte`
- `src/hooks.server.ts` — the session cookie into `locals.user` (an `Actor`, or null), sliding its expiry; the public pages' no-referrer, no-index, no-store headers
- `src/app.css` — the Design System's tokens, base and text roles, and the layout wrappers (`.form-stack`, `.chip-row`, `.detail-list`, `.screen__action`)
- `src/lib/components/` — the Design System's components in Svelte, keeping its BEM class names; only the ones a screen uses. Icons are `static/icons.svg`, the system's sprite
- `src/lib/*.ts` — pure, outside `server/` so forms recalculate as they're typed:
  - `datetime.ts` — every Bogotá date and time: `getTodaysDate`, formatting, Monday-to-Sunday week and month arithmetic, the typed a.m./p.m. clock
  - `phone.ts` — `normalizePhone`, the only normalizer, on save; `formatPhone`
  - `format.ts` — pesos, numbers, receipt numbers, `formatPesosInWords`; `fold`, accents and case off, for every search
  - `labels.ts` — every enum value's Spanish label
  - `navigation.ts` — the menu tree, filtered by role (`getMenu`), and the bottom bar's slots (`getBarSlots`); `getPageNumbers`
  - `settings.ts` — `SETTINGS`: each key's module, label, unit and Zod schema
  - `orders.ts` — `calculateOrderTotals`; `isLegalTransition`, the only rule for status changes; `nextOperationalStatus`, `isEditableStatus`, `isIncidentReportable`
  - `payroll.ts` — `calculateSettlement`, `deriveRates`, and the typed-text parsers both sides share
  - `offline.ts` — Despachos' offline copy: `fetchJson`, `readDispatchCache` (its only reader), `clearDispatchCache`; the products checklist, ticks kept on the phone per order and status (`readChecklist`)
- `src/lib/server/` — `actor.ts` (`Actor`, `requireRole`, `hasAnyRole`); `audit.ts` (`auditedInsert` / `auditedUpdate`: audit columns and the `events` row, as statements for one `db.batch()`); `password.ts`; `session-cookie.ts`; `markdown.ts` (`renderHelp` and `renderTerms`, the only HTML `{@html}` takes); `turnstile.ts`; `overtime.ts` (`deriveOvertime`); `order-changes.ts` (an edit's diff); `timeline.ts` (which events each role sees); `list-filters.ts` (lists' filters kept in a cookie); `chosen-employee.ts`
- `src/lib/server/services/` — business logic, one file per module; its `README.md` has the rule. The only rules for what they name: `cash.ts`' `movementStatements` (every insert into `cash_movements`), `orders.ts`' `getAvailability` and `MODIFIED_AFTER_STAGING_AT`, `inventory.ts`' `isStale`, `reversalBlock` and `getUnitsOnRent`, `receivables.ts`' `findEligibleOrders` and `canJoin`. `public-orders.ts` is the client's side: no actor, no writes
- `src/lib/server/db/` — `schema.ts`, Drizzle, source of `migrations/`; `memory-d1.ts`, the tests' D1 over `node:sqlite`
- `src/service-worker.ts` — the PWA shell cache, never a data response (hence `paths.relative: false`)
- `migrations/` — generated SQL; squashed freely until launch, append-only after
- `scripts/` — `settings-defaults.sql`, `catalog.sql`, `sample-data.sql`, `wipe-d1-if-squashed.js` (the deploy's pre-launch wipe)
- `.github/workflows/` — `verify.yml` (PRs), `deploy.yml` (merge to `main`); `.husky/` — `pre-commit`, `commit-msg`; `.claude/` — the allow and deny lists and the hooks; `docs/agents/` — the issue tracker, triage labels and domain docs the Agent skills read

## Agent skills

Per phase: `/wayfinder` (the phase map and its decisions, canvas included) → `/to-spec` (the spec issue) → `/to-tickets` (its tickets) → `/implement-spec` (AFK) → the developer merges. One-off work: `/triage` → `/implement`.

### Issue tracker

GitHub Issues in `consuelo-c/erp-app`; phase specs and tickets hang from the phase map. See `docs/agents/issue-tracker.md`.

### Triage labels

The five defaults, only on one-off issues. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. See `docs/agents/domain.md`.

### Running `/implement-spec`

These override the skill's defaults:

- **Sequential, in this tree.** One ticket at a time, each in a fresh implementer subagent using `/tdd`, working in this tree on the integration branch: no worktrees, no merger subagents.
- **Gaps.** A ticket that hits a gap, ambiguity or contradiction in the planning stops without committing, posts the question as a comment on the spec issue, and sends a push notification; it and the tickets it blocks wait, the rest go on. The developer's answer is recorded on the spec issue.
- **Finishing.** After `/code-review` and its fixes, the PR body is written with `/pr`, closing the spec and every ticket; push, open the PR, and watch CI until it's green. The developer merges.

## Hard rules

In [`.claude/rules/`](.claude/rules/), one file per area; Claude Code loads each only when working on the files its `paths` names.
