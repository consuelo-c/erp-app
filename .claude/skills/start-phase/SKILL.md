---
name: start-phase
description: Open a phase - check its screens, split it into units, propose one issue per unit. Usage - /start-phase 03
disable-model-invocation: true
argument-hint: <phase number>
---

# Start a phase

Open Phase $ARGUMENTS. `NN` below is that number, zero-padded (`3` → `03`).

This is a planning session: it writes no code; its only file is the issue script in the session's scratchpad (section 6). The process is `../planning/working-methodology.md` "Opening a phase"; this skill adds only what that section leaves to the session.

## 1. Preconditions

- `../planning/phase-NN/acceptance.md` exists. If it doesn't, stop: the criteria are written in a planning session in `../planning/` before the phase opens.
- Phases 00–02 are not opened here: 00 is done by hand, 01–02 use Prompt 0 in `../planning/phase-01/prompts.md`.

## 2. Read

- `../planning/working-methodology.md`: "Opening a phase" and section 4 ("The issues").
- `../planning/phase-NN/acceptance.md` whole, both halves.
- `../planning/foundations.md` and `../planning/phase-NN/planning.md`, whose _Screens_ section lists the phase's screens.

## 3. Existing issues

```bash
gh issue list --repo consuelo-c/erp-app --milestone "Phase NN" --state all
gh issue list --repo consuelo-c/erp-app --state open --search "no:milestone"
```

An issue that already exists is never proposed again. Unplaced ideas that belong to Phase NN get a `gh issue edit --milestone "Phase NN"` line in the issue script (section 6).

## 4. Screens

Follow "Opening a phase" → "Screens first". Use Claude in Chrome on the Design Project; if it isn't connected, ask the developer to connect it. Report each screen as **ready**, **missing** or **contradicting the current planning**, and write the Claude Design prompt for each one that isn't ready. Units are proposed only once the developer says every screen is ready.

## 5. Units

- Every criterion of `acceptance.md` falls in exactly one unit; the "MUST NOT exist" list applies to all of them.
- Each unit fits one short session and leaves the repository coherent.
- Walking the criteria to close the phase is a separate session, not a unit.

Show the list (title, criteria covered, order) and wait for approval.

## 6. Issue script

Write `phase-NN-issues.sh` in the session's scratchpad: one `create` per unit, in order, so the issue numbers follow it; then the idea placements from section 3. Titles and bodies in Spanish; each body opens with one sentence naming what the unit builds or fixes, so the issue reads on its own, then links the criteria heading and the planning heading it implements, without copying or restating them: a paraphrase drifts from the hard rules and the criteria. Quoted heredocs keep backticks and `$` in the bodies literal.

Planning links are pinned to the commit the session read, so they keep showing the text the issue was written from; `git diff <sha> main -- <file>` in `../planning/` shows what changed since. Get it with `git -C ../planning rev-parse --short HEAD` (GitHub resolves the short hash in `blob/` links), after `git -C ../planning fetch` and `git -C ../planning status -sb` show no changes and no `ahead`; otherwise ask the developer to commit and push the planning first.

```bash
#!/usr/bin/env bash
# Phase NN: <n> units + <m> idea placements. Review, then: bash <this file>
set -euo pipefail
R=consuelo-c/erp-app M="Phase NN"

# Creates a Task in the milestone unless one with this exact title exists; body on stdin
create() {
  if gh issue list --repo "$R" --milestone "$M" --state all --limit 200 \
      --json title --jq '.[].title' | rg -qxF -- "$1"; then
    echo "skip: $1"; cat >/dev/null; return
  fi
  gh issue create --repo "$R" --type Task --milestone "$M" --title "$1" --body-file -
}

create "<título de la unidad>" <<'EOF'
<Una oración: qué construye o arregla la unidad.>

Implementa [`phase-NN/planning.md#<heading>`](https://github.com/consuelo-c/erp-planning/blob/<sha>/phase-NN/planning.md#<heading>).
Criterios: [`phase-NN/acceptance.md#<heading>`](https://github.com/consuelo-c/erp-planning/blob/<sha>/phase-NN/acceptance.md#<heading>).
EOF

# Ideas placed in this phase
gh issue edit <N> --repo "$R" --milestone "$M"
```

Show the script in full with its absolute path and change it on request. The developer may edit it directly; re-read it before describing or changing it. The developer runs `! bash <path>`; if it fails, fix the file and they run it again: existing titles are skipped.

## 7. Planning findings

A contradiction in the documents is a question for the developer; an error is a `docs` issue command.
