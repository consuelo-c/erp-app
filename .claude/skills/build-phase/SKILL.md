---
name: build-phase
description: Build every unit of an opened phase on one branch, one fresh subagent and one commit per unit, then walk the criteria and open the pull request. Usage - /build-phase 19, in a session started with claude --permission-mode dontAsk
disable-model-invocation: true
argument-hint: <phase number>
---

# Build a phase

Build Phase $ARGUMENTS. `NN` below is that number, zero-padded (`3` → `03`). `R` is `consuelo-c/erp-app`.

The process is `erp-planning:working-methodology.md` "Building a phase"; this skill adds only what that section leaves to the run. `erp-planning:` names the planning repository's clone, a sibling of this one: find its folder by its remote (`git -C <folder> remote get-url origin` ending in `consuelo-c/erp-planning.git`).

**You are the orchestrator.** You build nothing, read no source file and no planning beyond what this skill names: every unit is a fresh subagent's. Keep only issue numbers, commit hashes, held questions and what each subagent returns. The session runs in `dontAsk` mode: whatever the allow list doesn't cover is refused without a prompt, and `AskUserQuestion` is refused too.

## 1. The gate

```bash
gh issue list --repo R --milestone "Phase NN" --state all --label wayfinder:map --json number,title,state
gh api repos/R/issues/<map>/sub_issues --jq '.[] | select(.state == "open") | .number'
gh issue list --repo R --milestone "Phase NN" --state open --limit 200 --json number,title,labels
git status -sb
```

Stop and say why unless:

- there is exactly one map, it is closed, and it has no open sub-issue;
- there is at least one open **unit**: an open issue in the milestone with no `wayfinder:*` label;
- the tree is clean.

## 2. The branch

The slug is the map's title after the dash, lowercased, accents off, spaces to hyphens: `Mapa: Phase 18 — Usuarios de WhatsApp y cuentas de cobro` → `feat/478-usuarios-whatsapp-y-cuentas-de-cobro` (short words like `de` may stay).

- If that branch already exists, this is a resumed run: `git switch` to it. A unit whose number ends a commit subject in `git log main..HEAD` (`(#482)`) is done.
- Otherwise `git switch main`, `git fetch`, check `main` is level with `origin/main`, then `git checkout -b <branch>`.

Never work on `main`.

## 3. The order

For each open unit, its open blockers:

```bash
gh api repos/R/issues/<n>/dependencies/blocked_by --jq '.[] | select(.state == "open") | .number'
```

A blocker that is a unit of this phase counts as done once it is committed on the branch: its issue only closes at the merge. A unit is **ready** when every blocker is done. Take ready units by issue number. The canvas unit (title starting «Actualizar el canvas») goes last of the units whatever its edges say.

## 4. A unit

Start one subagent per unit, in the foreground, one at a time: units share the working tree. Give it this brief and nothing from your own context:

> You are building one unit of Phase NN in `erp-app`, on branch `<branch>`: issue #<n>. Read the issue (`gh issue view <n> --repo R`), then follow `CLAUDE.md`: read what "Starting a unit" and "Building a screen" name, build the unit end to end, and close it as `erp-planning:working-methodology.md` §3 says: `npm run lint` clean, the diff reviewed against §13, the unit's files staged by name, one commit `<type>: <subject> (#<n>)` within 100 characters, then `git push -u origin <branch>`. Record every open item as an issue (§4, bodies written out in full) before you return.
>
> You're in `dontAsk` mode: a refused command is not a question. Work around it, or report it.
>
> If a gap is one that "stops and asks" (Gaps in the planning), don't guess: run `git stash push -u -m "#<n>"` so the tree is clean, and return `HELD` with the question written so it reads on its own: what you found, where, the options, the one you'd recommend.
>
> Return, in a few lines: `DONE <commit hash>` or `HELD`; the issues you created; the readings you chose for gaps; any command you were refused; for a screen built without a page it needed, which page.

For the canvas unit, add: "This unit has no commit: publish the pages and return the list of pages you changed."

After each `DONE`, check `git status` is clean and `git log -1` names the unit. If not, start one fresh subagent to fix it before the next unit.

## 5. Held units

On the first `HELD`, send a push notification: «Phase NN: una pregunta espera respuesta». Keep the subagent: you'll resume it. Units blocked by a held one wait too.

When no unit is ready, ask the held questions in plain chat, one per message, the subagent's own words with its recommendation. Send each answer to its subagent with SendMessage: "Answer: <answer>. Pop your stash (`git stash list`, `git stash pop` the one named #<n>), resolve any conflict, write the answer into the open phase's `erp-planning` planning as Gaps in the planning says, finish the unit, and return as before." Then continue with §3.

## 6. The criteria walk

A fresh subagent, after every unit and the canvas unit:

> Walk `erp-planning:phase-NN/acceptance.md` against branch `<branch>`, both halves, with special attention to the "Must NOT exist" list (`erp-planning:working-methodology.md` §9 and §14). Run `npm run test`. A criterion that fails and can be fixed: fix it in one `fix:` commit and push. One that won't be fixed now: an issue labelled `debt` in the milestone, body written out in full. Return each criterion as passes / fixed (commit) / debt (issue) / manual (what the developer checks, and how).

## 7. The pull request

`gh pr create --repo R --base main --head <branch>`, in Spanish:

- **Title:** `Fase NN: <the map's title after the dash>`.
- **Body:** a paragraph on what the phase builds; `Closes #N` per unit, one per line; «Verificación manual», a checklist of the manual criteria; «Issues creados»; «Decisiones tomadas en la construcción», the readings chosen for gaps; «Canvas», the pages changed; «Cambios en la planeación», the `erp-planning` files the answers changed, uncommitted, for the developer to commit there; «Comandos rechazados», if any. No attribution line.

Then `gh pr checks <pr> --repo R --watch`. A red check: read its log (`gh run view <run> --repo R --log-failed`), start a fresh subagent with the failure and the branch to fix it in one `fix:` commit and push, and watch again. Stop after three rounds on the same check, and say so.

## 8. The end

Push notification: «Fase NN: PR #<pr> en verde, lista para merge» (or what is left). The closing message lists the commits, the issues created, the held questions with their answers, and what the developer checks by hand. Merging is the developer's: never `gh pr merge`.
