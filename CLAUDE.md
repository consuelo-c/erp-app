# erp-app

SvelteKit app for Banquetes Consuelo C, deployed as a Cloudflare Worker.

## Stack

- SvelteKit 2 + Svelte 5, TypeScript, `adapter-cloudflare` (Workers), configured in `vite.config.ts`
- D1 (binding `DB`) and R2 (binding `BUCKET`), declared in `wrangler.jsonc`. A single environment: `main` is production
- Drizzle is only used to generate migrations (`src/lib/server/db/schema.ts` → `migrations/`); they are applied with `wrangler d1 migrations apply`
- Vitest (unit, node), ESLint, Prettier, Stylelint; husky runs gitleaks, lint-staged and commitlint

## Commands

- `npm run test` — unit tests (Claude runs this)
- `npm run lint` / `npm run format` — ESLint + Stylelint / Prettier
- `npm run db:generate` — new migration from the schema
- `npm run build`, `npx wrangler dev` — local run on the Workers runtime

## Rules

- The developer runs every write command (git add/commit/push, npm install, wrangler create/deploy/apply, gh issue/pr create, gh project item-edit); the deny list is in `.claude/settings.json`. Claude proposes Conventional Commits with Spanish descriptions
- Issues, issue comments and pull requests are written in Spanish (title and body); code identifiers, paths, commands and closing keywords inside them stay as they are: a pull request closes its issue with `Closes #N`, never `Cierra #N`
- Code follows [../planning/07-Working-Methodology.md §13 Code standards](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md#13-code-standards); read it before writing code. Run `npm run lint` and fix every error before proposing a commit
- Deploys only happen from CI (`.github/workflows/deploy.yml` on merge to `main`), never by hand. `verify.yml` runs on PRs; its `test` job is the required check
- Build only what the current unit's issue asks for. Anything temporary gets a `STUB: phase N replaces this with …` comment and a `debt` issue
- No secrets in the repo: `.env.example` lists keys only; local values go in `.dev.vars`

## Planning

Planning lives in `../planning/`. Start at [../planning/07-Working-Methodology.md](https://github.com/consuelo-c/erp-planning/blob/main/07-Working-Methodology.md). Links from this repo use the local path as text and the GitHub URL as target.
