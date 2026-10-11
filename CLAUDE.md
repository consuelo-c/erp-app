# erp-app

SvelteKit app for Banquetes Consuelo C, deployed as a Cloudflare Worker. Planning lives in the sibling repository `../planning/` ([`consuelo-c/erp-planning`](https://github.com/consuelo-c/erp-planning)), never copied here. All issues, milestones (`Phase 00` to `Phase 12`) and labels live in `consuelo-c/erp-app`: pass `--repo consuelo-c/erp-app` to every `gh` command.

## Always

- **The developer runs every write command** (git add/commit/push, npm install, wrangler create/deploy/apply/secret, gh issue/pr create, gh project item-edit); Claude runs read-only ones, `npm run test`, `lint` and `typecheck` included. When a write command is needed, propose the exact command and wait for the developer to say it ran. Enforced by the deny list in `.claude/settings.json`
- **Language.** Chat, code and docs in English; `README.md` and user-facing UI in Spanish. Issues, issue comments and pull requests in Spanish (title and body); code identifiers, paths, commands and closing keywords stay as they are: `Closes #N`, never `Cierra #N`
- **Scope.** Build what the declared unit needs to work end to end, glue included; a feature or screen another unit or a later phase owns gets a stub, not an implementation
- **No project state here or in Claude Code memory.** The plan lives in `../planning/`, the state in the issues
- **Planning references** are Markdown links: local path as text, GitHub URL as target. Only `hard-rules.md` is imported (below); every other planning file is read through its link when the moment comes, never `@import`ed

## When to read what

All in [../planning/07-Working-Methodology.md](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md) (`07`) unless named.

- **Opening a session** — `07` [§7](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#7-opening-and-closing-a-session): the milestone's open issues, not the planning
- **Opening a phase** — `07` [Opening a phase](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#opening-a-phase) (screens first, then one issue per unit); [../planning/02-planning/README.md](https://github.com/consuelo-c/erp-planning/blob/main/02-planning/README.md) for which planning files the phase needs
- **Starting a unit** — `07` [The cycle](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#the-cycle) (branch, move to `Doing`; if that command fails or its `--id` is empty, ask the developer to move it by hand); the phase's whole criteria file, both halves: `../planning/05-acceptance/phase-NN.md`
- **Building a screen** — `07` [Opening a phase](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#opening-a-phase): only the screens handed off into the session; ask for a missing one of the same phase
- **Needing something another unit or phase owns** — `07` [Stubs are the way out](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#stubs-are-the-way-out)
- **Finding a gap, ambiguity, error or contradiction in the planning** — `07` [Gaps in the planning](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#gaps-in-the-planning) and [§4](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#4-the-issues)
- **Writing code** — `07` [§13 Code standards](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#13-code-standards)
- **Creating an issue** — `07` [§4](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#4-the-issues)
- **Closing a unit** — `07` [§3 Commits](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#3-commits)
- **Closing a session** — `07` [§7](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#7-opening-and-closing-a-session)
- **Closing a phase** — `07` [§9](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#9-closing-a-phase)
- **Using a skill that reviews or trims code (ponytail)** — `07` [§10](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#10-the-skills): the planning wins over the skill

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
- `src/lib/datetime.ts` — `getTodaysDate`, `formatInstant`: Bogotá dates and times
- `src/lib/server/actor.ts` — `Actor` and the permission helpers (`requireRole`, `hasAnyRole`, …)
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

## Hard rules

Imported from the planning, so they are always current. Cited by name, not by number.

@../planning/02-planning/hard-rules.md
