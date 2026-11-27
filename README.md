# ERP Banquetes Consuelo C

## Requirements

- A Cloudflare account
- A GitHub account
- Node and npm (a version manager such as mise or nvm works)
- The `gh` command
- A Claude account with access to the design canvas (see [Design](#design))

## Cloudflare

### Create the `API Token`

Needed to deploy from GitHub.

Go to _My Profile -> API Tokens -> Create Token -> Create Custom Token_

Add the `Edit` permission, of type `Account`, to:

- Workers Scripts
- D1
- Workers R2 Storage

> [!CAUTION]
> Copy the `API Token`: it is never shown again, and the GitHub **secrets** setup needs it

### Create the D1 database and the R2 bucket

```bash
npx wrangler login
npx wrangler whoami # Make sure it's the right account
```

> [!IMPORTANT]
> The `Account ID` goes in `wrangler.jsonc`'s `account_id` key (the `Account ID` is public, so it doesn't need to be a secret). It lives in that file, not in an environment or GitHub variable, so the deploy can't land in the wrong account

Create the database

```bash
npx wrangler d1 create consueloc-erp-db
npx wrangler d1 list --json
```

And the bucket

```bash
npx wrangler r2 bucket create consueloc-erp-arch
npx wrangler r2 bucket list --json
```

> [!TIP]
> `npm run env:create` creates both (the database and the bucket) in the Cloudflare account. Copy the `database_id` it prints into `wrangler.jsonc`

## GitHub

The repository is assumed to exist.

### Protect the `main` branch

Go to _Settings -> Rules -> Rulesets -> New branch ruleset_ and create a rule with these parameters:

- _Enforcement status_: `Active`
- Branch `main`
- _Restrict deletions_ and _Block force pushes_
- _Require a pull request before merging_
- **Pending**: _Require status checks to pass -> Test_

> [!NOTE]
> The pending rule can only be created after GitHub Actions has run once

### Create the GitHub project

Create the **ERP Banquetes Consuelo C** project and adjust its columns and, optionally, its workflows.

> [!TIP]
> Projects can be created from the terminal too, but boards can't be managed there, so this whole step is best done on the web.
>
> ```bash
> gh project create --owner "consuelo-c" --title "ERP Banquetes Consuelo C"
> gh project list --owner "consuelo-c"
> ```

- Create the project's columns (the _Status_ field: rename _In Progress_ to _Doing_ and add _Pending_)
  - Todo
  - Doing
  - Pending
  - Done
- Create the project's views
  - Board -> Kanban, checking it has the _Todo_, _Doing_, _Pending_ and _Done_ columns
  - Phases -> Table -> grouped by milestone

> [!NOTE]
> Check that two workflows exist: one that adds a new issue to _Todo_, and one that moves a closed issue to _Done_

### Let `gh` read and edit projects

```bash
gh auth login
gh auth refresh -s project,read:project
```

### Add Cloudflare's `API Token` as a secret

```bash
gh secret set CLOUDFLARE_API_TOKEN # Have the token at hand
gh secret list
```

### Clean up the issue labels

Delete the issue labels we won't use

```bash
gh label delete 'good first issue'
gh label delete 'help wanted'
gh label delete documentation
gh label delete duplicate
gh label delete enhancement
gh label delete invalid
gh label delete question
```

### Create the project's labels

The five triage labels and the wayfinder labels:

```bash
gh label create needs-triage --color fbca04 --description "Maintainer needs to evaluate this issue"
gh label create needs-info --color d4c5f9 --description "Waiting on reporter for more information"
gh label create ready-for-agent --color 0e8a16 --description "Fully specified, ready for an AFK agent"
gh label create ready-for-human --color 1d76db --description "Requires human implementation"
gh label create wontfix --color ffffff --description "Will not be actioned"
for t in grilling prototype research task; do gh label create "wayfinder:$t"; done
gh label create wayfinder:map
```

> [!TIP]
> `gh issue list --web` opens the issue list in a browser

### Create the milestones

```bash
for i in $(seq 0 16); do
  gh api repos/:owner/:repo/milestones -f title="$(printf 'Phase %02d' "$i")" >/dev/null
done
gh api repos/:owner/:repo/milestones --jq '.[].title'
```

> [!NOTE]
> Milestones belong to the repository (Issues -> Milestones), while projects belong to the organization (Org -> Projects). This matters when managing the project

## Deploy to Cloudflare

> [!NOTE]
> The app has been in production since launch (the first real order). Production data is the company's record: nothing wipes or truncates it, and `migrations/` is append-only.

This section explains how to put the app in production, what data it needs to work, and how to check that the deploy went well. It assumes the steps in [Cloudflare](#cloudflare) and [GitHub](#github) are done: the database, the bucket, the `API Token` and the repository exist.

There is a single environment: no staging (see [Set up a staging environment](#set-up-a-staging-environment)), so `main` is production. Deploys aren't run by hand from the terminal but through GitHub Actions' `.github/workflows/deploy.yml` workflow. A manual `npx wrangler deploy` only makes sense to debug a specific problem.

### What the deploy does

Every run, the workflow does these steps in order:

1. Installs the dependencies with `npm ci`.
1. Runs the tests. If one fails, it stops there, before touching the database.
1. Applies the pending migrations to D1.
1. Loads the default `settings` from `scripts/settings-defaults.sql`.
1. Builds the app and publishes it with `wrangler deploy`.

### Environment variables and secrets

The app needs no config file in production. What grants **access** is stored as a secret, outside the repository; what only says **which resource** to use lives in `wrangler.jsonc`, since it's useless without credentials.

| Name                   | What it's for                                          | Where it lives   | How it's set                                        |
| ---------------------- | ------------------------------------------------------ | ---------------- | --------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN` | Lets GitHub Actions deploy to Cloudflare               | GitHub Secrets   | `gh secret set CLOUDFLARE_API_TOKEN`                |
| `ADMIN_PASSWORD`       | The password the Worker creates the `admin` login with | Worker secret    | `npx wrangler secret put ADMIN_PASSWORD`            |
| `PASSWORD_PEPPER`      | A random value mixed into every password's hash        | Worker secret    | `npx wrangler secret put PASSWORD_PEPPER`           |
| `account_id`           | Which Cloudflare account to deploy to                  | `wrangler.jsonc` | Copied from `npx wrangler whoami`                   |
| `database_id`          | Which D1 database the Worker uses                      | `wrangler.jsonc` | Copied from `npx wrangler d1 info consueloc-erp-db` |

The `DB` (D1) and `BUCKET` (R2) bindings are already declared in `wrangler.jsonc`, so they need no setup anywhere else.

> [!NOTE]
> In development, the two Worker secrets go in `.dev.vars`, which stays out of the repository; `.env.example` lists their names. There, use a `PASSWORD_PEPPER` different from production's.

> [!TIP]
> After editing `wrangler.jsonc`, run `npx wrangler types` to regenerate the types.

### Initial data

A new install starts with no business data. Some data arrives with the deploy and some is loaded by hand.

Arrives on its own:

- **Default settings:** every deploy applies `scripts/settings-defaults.sql`, which brings the company's details, the payroll parameters, the holidays and the help's first draft. It only adds missing keys, so it never overwrites a value edited in the app.
- **The `admin` login:** it's in no seed. The Worker creates it with `ADMIN_PASSWORD`'s value on the first login attempt, so production's `PASSWORD_PEPPER` never leaves Cloudflare.

Loaded by hand:

- **WhatsApp and terms and conditions:** `COMPANY_WHATSAPP` and `TERMS_CONDITIONS` arrive empty and are filled in from _Configuración_ in the app.
- **The product catalog:** following [Load the catalog](#load-the-catalog).
- **Order numbering:** following [Set the orders sequence](#set-the-orders-sequence).
- **Receivable numbering:** following [Set the receivables sequence](#set-the-receivables-sequence).

> [!CAUTION]
> `scripts/sample-data.sql`, loaded by `npm run db:seed`, holds sample data and is for development only. Never run it in production.

### Step 1: Confirm the account and the resources

Before deploying, make sure you're working in the right account. This matters when handling several Cloudflare accounts, because the mistake is silent: the deploy may fail with what looks like a permissions problem or, worse, succeed in the wrong account.

```bash
npx wrangler whoami
npx wrangler d1 info consueloc-erp-db
npx wrangler r2 bucket list
gh secret list --repo consuelo-c/erp-app
```

With those commands' output, check that:

- The account's `Account ID` equals `wrangler.jsonc`'s `account_id`
- The database's ID equals `wrangler.jsonc`'s `database_id`
- The `consueloc-erp-arch` bucket is listed
- The `CLOUDFLARE_API_TOKEN` secret is listed

### Step 2: Run the deploy

The workflow runs in two ways: automatically on a merge to `main`, or by hand with `gh workflow run`. Neither works while the workflow is disabled, so check its state first and enable it if needed.

```bash
gh workflow list --all --repo consuelo-c/erp-app
gh workflow enable deploy.yml --repo consuelo-c/erp-app
```

The first command shows `active` if the workflow is enabled and `disabled_manually` if not. Once enabled, launch the deploy and follow it in the terminal. If `gh run watch` asks which run to follow, pick _Deploy_.

```bash
gh workflow run deploy.yml --ref main --repo consuelo-c/erp-app
gh run watch --exit-status --repo consuelo-c/erp-app
```

> [!IMPORTANT]
> While the workflow is enabled, **every merge to `main` deploys to production**. To deploy only on purpose, disable it again when done:
>
> ```bash
> gh workflow disable deploy.yml --repo consuelo-c/erp-app
> ```

### Step 3: Create the Worker's secrets

Secrets are stored in the Worker and survive deploys, so this step is only done once. Without them the public page loads, but nobody can log in or look up an order.

First check which exist, to create only the missing ones:

```bash
npx wrangler secret list
```

Then create the ones not listed. `wrangler` asks for the password in the terminal, while the pepper is generated with `openssl`:

```bash
npx wrangler secret put ADMIN_PASSWORD
openssl rand -base64 32 | npx wrangler secret put PASSWORD_PEPPER
```

> [!CAUTION]
> If `PASSWORD_PEPPER` is already listed, **don't generate it again**. Replacing it breaks every password. See [Create the `admin` password](#create-the-admin-password).

### Step 4: Configure Cloudflare's dashboard

Two things don't live in the repository and are set once from the dashboard. The domain must be added after the first deploy, because before it there's no Worker to point at.

**The app's domain.** Go to _Workers & Pages -> `consueloc-erp` -> Settings -> Domains & Routes -> Add -> Custom domain_ and add `app.consueloc.com`. Cloudflare creates the DNS record and issues the certificate itself, which can take a few minutes.

**The login attempts limit.** This limit isn't in the code. Go to _`consueloc.com` -> Security -> WAF -> Rate limiting rules_ and create a rule covering `POST` requests to `app.consueloc.com/login`. The free plan includes one rule.

### Step 5: Load the initial data

Last, load the data done by hand, described in [Initial data](#initial-data). This is only for a fresh, empty database, before the first order.

### Verify the deploy

To be sure everything went well, first check from the terminal that the deploy finished and that the Worker and the database are as expected.

The last deploy must show as `success`, and the Worker's latest version must match it:

```bash
gh run list --workflow deploy.yml --limit 1 --repo consuelo-c/erp-app
npx wrangler deployments list
```

The two secrets must be listed: `ADMIN_PASSWORD` and `PASSWORD_PEPPER`. `TURNSTILE_SECRET_KEY` may be listed too: it's kept, with its Turnstile widget in the dashboard, for a possible return of a public form, and the app doesn't read it:

```bash
npx wrangler secret list
```

No migration may be pending:

```bash
npx wrangler d1 migrations list consueloc-erp-db --remote
```

The `settings` table must have rows:

```bash
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT count(*) AS total FROM settings"
```

This query lists the company details still empty. Before launch it must return no rows:

```bash
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT key FROM settings WHERE key IN ('COMPANY_WHATSAPP', 'TERMS_CONDITIONS') AND value = ''"
```

The domain must answer with status `200`:

```bash
curl -sI https://app.consueloc.com | head -n 1
```

The Worker's `workers.dev` URL must not answer, because `wrangler.jsonc` turns `workers_dev` and `preview_urls` off so production only answers on `app.consueloc.com`. `npx wrangler deployments list` doesn't show it; if you know it, this request must fail or return a Cloudflare error:

```bash
curl -sI https://consueloc-erp.<subdomain>.workers.dev | head -n 1
```

Then check in the browser at `https://app.consueloc.com`.

- [ ] The `/` page loads and shows the logo and the «Empleados» link
- [ ] The `/login` page lets you in with the `admin` login and the password stored in `ADMIN_PASSWORD`
- [ ] _Productos_ shows the imported catalog
- [ ] _Configuración_ shows the company's details

> [!WARNING]
> Don't create test orders in production. An order takes a number from the `orders` sequence, so a test order would leave a gap in the paper numbering, and it would stay in the company's record, which is never deleted.

## Back up the database

The `.github/workflows/backup-d1.yml` workflow exports the production database, `consueloc-erp-db`, to a plain SQL file and uploads it to the private R2 bucket `consueloc-erp-arch`. It uses the same `CLOUDFLARE_API_TOKEN` secret as the deploy, and the account ID in `wrangler.jsonc`.

### When it runs

- **On a schedule:** at 03:00 Bogotá time on odd calendar days (1, 3, 5 … 31), cron `0 8 1-31/2 * *` in UTC. Gaps between backups are 1 or 2 days, because the cron resets each month.
- **By hand:** from _Actions -> Back up D1 -> Run workflow_ on GitHub, for example right before a risky migration. From the terminal:

```bash
gh workflow run backup-d1.yml --ref main --repo consuelo-c/erp-app
gh run watch --exit-status --repo consuelo-c/erp-app
```

A failed export or upload fails the run, and GitHub emails the failure. A failed export never uploads.

### Where the dumps live

Each run uploads one object to `consueloc-erp-arch` under `backups/d1/`, named after the database and the run's UTC time, so the keys sort by time:

```text
backups/d1/consueloc-erp-db-2026-11-25T08-00-00Z.sql
```

Retention is the R2 lifecycle rule `d1-backups`: every object under the `backups/d1/` prefix, manual runs included, is deleted 60 days after it's uploaded. The workflow never deletes anything. The rule is already live on `consueloc-erp-arch`; on a new bucket, re-create it with:

```bash
npx wrangler r2 bucket lifecycle add consueloc-erp-arch d1-backups backups/d1/ --expire-days 60 --force
npx wrangler r2 bucket lifecycle list consueloc-erp-arch
```

> [!WARNING]
> If the backups fail for 60 days in a row, every dump expires and **no backup is left**. Don't ignore the workflow's failure emails.

### Restore a dump

Wrangler can't list R2 objects, so find the key of the dump to restore in the dashboard (_R2 -> `consueloc-erp-arch` -> `backups/d1/`_), or from a run's log in _Actions -> Back up D1_. Download it:

```bash
npx wrangler r2 object get consueloc-erp-arch/backups/d1/consueloc-erp-db-2026-11-25T08-00-00Z.sql --file dump.sql --remote
```

Then load it into an **empty** database: the dump creates the tables, so it fails on a database that already has them.

```bash
npx wrangler d1 execute <database> --remote --file=dump.sql
```

> [!CAUTION]
> To check a dump, restore it into a scratch database (`npx wrangler d1 create <scratch-name>`, then delete it with `npx wrangler d1 delete <scratch-name>`). To restore production, `consueloc-erp-db` must be emptied or re-created first, and its `database_id` in `wrangler.jsonc` updated if it's re-created. `--remote` matters in both commands: without it, Wrangler reads and writes the local copies.

## Set up a staging environment

This section is a recipe: **none of it is built**. Until someone follows it, there is still a single environment and `main` is production. Staging is for showing users work in progress, even an unmerged branch, without touching production.

### The design

- **Domain:** `stg-app.consueloc.com`, added as a custom domain of the staging Worker (as in [Step 4](#step-4-configure-cloudflares-dashboard)).
- **A `staging` environment in `wrangler.jsonc`** (`env.staging`), with its own D1 database and R2 bucket, created with the CLI as in [Create the D1 database and the R2 bucket](#create-the-d1-database-and-the-r2-bucket). Bindings aren't inherited between environments, so `env.staging` repeats each one: `DB` and `BUCKET`.
- **No sample data:** `scripts/sample-data.sql` stays development-only. The `settings` come with the production copy.
- **The R2 bucket stays empty:** nothing in the app reads R2 today; the bucket only exists so the binding resolves.
- **Open:** the app's logins protect it, as they do production. No Cloudflare Access.
- **A fixed banner on every page, «Ambiente de pruebas: lo que se haga aquí se borra»**, on both the session pages and the public ones. A variable only the `staging` environment defines turns it on. It keeps anyone from taking a real order in staging or sending a client a staging link by mistake.

### Deploying

Staging is deployed from the terminal, not from GitHub Actions: `npm run deploy:staging`, run from the branch to show, runs the tests, builds and deploys with `--env staging`.

**Every deploy starts from a fresh copy of production's D1.** The script exports the production database, empties staging's, imports the export, applies the branch's migrations and then deploys. Everything done in staging is lost on the next deploy. The step reads production and never writes to it, and the only thing it empties is staging's database. `scripts/wipe-d1-if-squashed.js` isn't needed there, because the copy already replaces the whole database.

> [!WARNING]
> Risks of deploying from the terminal:
>
> - The working folder is deployed as it is, **uncommitted changes included**.
> - Nothing records who deployed what.
> - An `npx wrangler deploy` without `--env staging` **publishes to production**.

### Secrets

**Staging's `PASSWORD_PEPPER` is production's**, so every employee logs into staging with their real password. With a different pepper, the hashes copied from production would let nobody in, not even `admin`, because the Worker only creates `admin` when it doesn't exist. The other secret, `ADMIN_PASSWORD`, is created with `npx wrangler secret put <NAME> --env staging`.

### When it's built

The documents that say there's no staging change: `CLAUDE.md`'s Stack section and this `README.md`.

## Design

The design lives in three places. Its terms are in [`GLOSSARY.md`](GLOSSARY.md).

| Where                                                                                  | What it holds                                                                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The brand, in [`consuelo-c/branding`](https://github.com/consuelo-c/branding)          | The company's logo, colors, font, radii, voice and messages                                                                                 |
| The Design System, in the code                                                         | The app's own tokens (`src/app.css`), components (`src/lib/components/`) and icons (`static/icons.svg`); its rules in `.claude/rules/ui.md` |
| The canvas, [Consuelo C ERP Canvas](https://claude.ai/artifact/TBE5f1FaBxQJxkKwncJspg) | The screens and printouts: one page per section (`project/08 Despachos, Recogidas y Transiciones.dc.html`), with its frames                 |

The canvas is a private artifact: only the Claude account that created it and the people it's shared with, from the artifact itself, can see it.

### From the browser

Open the link while signed into Claude. Screens are designed in the canvas: open it in its editor, in Claude, and ask for the change in the chat. A phase's screens are drawn while working its map (`/wayfinder`). The artifact gallery is at <https://claude.ai/code/artifacts>.

### From Claude Code

Claude Code reads it with the `Artifact` tool, using the Claude account `claude` is signed into. Nothing needs exporting and no browser is needed:

- The canvas is read by path: first the page list, `project/compat.json`, then only the pages of the screens the issue names.
- Claude Code publishes to it only when a page has to match the code, and says which pages it changed.
- The Design System isn't an artifact: it lives in the code and changes with it.

> [!TIP]
> In the `claude` terminal, the `/artifacts` command lists the account's artifacts: `o` opens one in the browser and `c` copies its link.

The old Claude Design copies (`claude.ai/design/p/…`) are read-only and keep the chats and comments from before the move. Standalone Claude Design shuts down on December 14, 2026.

## Development workflow

Every session runs in this repository with Claude Code, using [Matt Pocock's skills](https://github.com/mattpocock/skills) (the `mattpocock-skills` plugin). Their per-repo configuration lives in `docs/agents/` and in the `## Agent skills` section of `CLAUDE.md`. Claude takes the work to a green pull request; the developer merges.

### Starting a session

Every session runs in auto mode; project settings can't turn it on, so it goes on the command line. Planning sessions (`/wayfinder`, `/to-spec`, `/to-tickets`) also turn ponytail off:

```sh
# Planning
claude --permission-mode auto --settings '{"enabledPlugins":{"ponytail@ponytail":false}}'
# Building (/implement-spec, /implement)
claude --permission-mode auto
```

A shell alias for each saves the typing. A session started without the flag runs in `default` mode, asking before anything outside the allow list, and a startup hook reminds you to restart.

### A phase (milestone)

1. **Create the milestone and the map.** Create the `Phase NN` milestone if it doesn't exist, then start `claude` and run `/wayfinder` with a loose description of the phase. Claude grills you to name the destination and charts the map: an issue labelled `wayfinder:map` with one child ticket per open decision.
2. **Work the map, one ticket per session.** In a fresh session, `/wayfinder <map>`: Claude takes the next ticket on the frontier (or the one you name) and resolves it with you. Research tickets run in parallel subagents. The canvas screens are drawn here, as `wayfinder:prototype` tickets. Repeat until no ticket is left.
3. **Write the spec.** In the session that closed the last ticket, or a fresh one after reading the map, `/to-spec`. It confirms the test seams with you and publishes the spec as a sub-issue of the map, in the milestone.
4. **Slice it into tickets.** `/to-tickets #<spec>`. Review the proposed slices and their blocking edges until they're right; Claude publishes them as sub-issues of the spec, in the milestone, with native blocking and no triage label.
5. **Build it unattended.** In a building session, run `/implement-spec #<spec>`. It builds the tickets one at a time on one branch, each in a fresh subagent with TDD, then runs a code review, fixes it, writes the PR body with `/pr` and waits until CI is green.
   - If a ticket hits a gap in the planning, Claude posts the question as a comment on the spec and sends a push notification; answer it there and tell the session to continue. The other tickets keep going meanwhile.
6. **Merge.** Review the pull request and merge it. The merge closes the spec and its tickets; close the map and the milestone.

The phases built before this workflow are frozen: their planning is in the archived [`consuelo-c/erp-planning`](https://github.com/consuelo-c/erp-planning), one `phase-NN/planning.md` each, read-only.

### One-off work

A bug, a request from the client, or a small change outside a phase:

1. Create the issue (or ask Claude to), then `/triage #N` to label it.
2. `/implement #N` in a fresh session: Claude branches as `<type>/<issue>-<slug>` (`feat`, `fix`, `chore` or `docs`, for example `fix/568-order-printout-title`), builds it with TDD, reviews it, and opens a pull request with `Closes #N`.
3. Merge it.

> [!TIP]
> `gh issue list --label wayfinder:map` lists the maps; `gh issue list --milestone "Phase NN"` shows what is left in a phase.

## Create the `admin` password

Locally, `npm run dev` looks for these values in the environment variables or in `.dev.vars`.

```bash
echo "ADMIN_PASSWORD=..." >> .dev.vars
echo "PASSWORD_PEPPER=$(openssl rand -base64 32)" >> .dev.vars
```

On Cloudflare the password is a secret, as is `PASSWORD_PEPPER`, so use `wrangler`:

```bash
npx wrangler secret put ADMIN_PASSWORD
openssl rand -base64 32 | npx wrangler secret put PASSWORD_PEPPER
```

> [!CAUTION]
> If production's `PASSWORD_PEPPER` changes, every user loses access. Keeping `openssl`'s output in Bitwarden may be a good idea

> [!IMPORTANT]
> `ADMIN_PASSWORD` is only read while the `admin` login doesn't exist, that is, until the first login attempt. After that, changing the secret doesn't change the password: it's changed in the app, in _Logins → `admin` → Cambiar contraseña_.

## Load the catalog

The real catalog is in `scripts/catalog.sql`, built by hand once from the WooCommerce export and the tablecloth inventory. From then on the catalog is kept in _Productos_, not in WooCommerce. In development, `npm run db:seed` loads it. In production it's loaded once, by hand, only on an empty database, before the first order:

```bash
npx wrangler d1 execute consueloc-erp-db --remote --file scripts/catalog.sql
```

- `deploy.yml` never applies it: a product renamed in _Productos_ would come back as a duplicate.
- It can run several times: a product whose name already exists (case-insensitive) is skipped.

## Set the orders sequence

So the app's first order follows the paper numbering, the `orders` sequence is set once in production to the last paper number.

Do it only on an empty database, before the first order.

> [!NOTE]
> Replace `NNNN` with the last paper number:

```bash
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT seq FROM sqlite_sequence WHERE name = 'orders'"
npx wrangler d1 execute consueloc-erp-db --remote --command "INSERT INTO sqlite_sequence (name, seq) VALUES ('orders', NNNN)"
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT seq FROM sqlite_sequence WHERE name = 'orders'"
```

> [!WARNING]
> The first `SELECT` must return no rows. If it returns one, an order already exists: don't run the `INSERT`. The last `SELECT` must return `NNNN`.

## Set the receivables sequence

So the app's first receivable follows the paper numbering, the `receivables` sequence is set once in production to the last paper number.

Do it after launch and before issuing the first receivable.

> [!NOTE]
> Replace `NNNN` with the last paper number:

```bash
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT seq FROM sqlite_sequence WHERE name = 'receivables'"
npx wrangler d1 execute consueloc-erp-db --remote --command "INSERT INTO sqlite_sequence (name, seq) VALUES ('receivables', NNNN)"
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT seq FROM sqlite_sequence WHERE name = 'receivables'"
```

> [!WARNING]
> The first `SELECT` must return no rows. If it returns one, a receivable has already been issued: don't run the `INSERT`. The last `SELECT` must return `NNNN`.
