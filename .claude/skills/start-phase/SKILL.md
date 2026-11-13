---
name: start-phase
description: Open a phase - check its screens, split it into units, propose one issue per unit. Usage - /start-phase 03
disable-model-invocation: true
argument-hint: <phase number>
---

# Start a phase

Open Phase $ARGUMENTS. `NN` below is that number, zero-padded (`3` → `03`).

This is a planning session: it writes no code; its only file is the issue script in the session's scratchpad (section 6). The process is `erp-planning:working-methodology.md` "Opening a phase"; this skill adds only what that section leaves to the session.

`erp-planning:` names the planning repository's clone, a sibling of this one: before anything else, find its folder among the siblings by its remote (`git -C <folder> remote get-url origin` ending in `consuelo-c/erp-planning.git`), and use it as `<planning>` below.

## 1. Preconditions

- The phase's milestone has a `wayfinder:map` issue, and it is closed: the planning is done. If it isn't, stop: the map is worked with `/wayfinder` from `erp-planning`.
- `erp-planning:phase-NN/acceptance.md` exists. If it doesn't, stop: the criteria are written in a planning session in `erp-planning` before the phase opens.
- Phases 00–02 are not opened here: 00 is done by hand, 01–02 use Prompt 0 in `erp-planning:phase-01/prompts.md`.

## 2. Read

- `erp-planning:working-methodology.md`: "Opening a phase" and section 4 ("The issues").
- `erp-planning:phase-NN/acceptance.md` whole, both halves.
- `erp-planning:foundations.md` and `erp-planning:phase-NN/planning.md`, whose _Screens_ section lists the phase's screens.

## 3. Existing issues

```bash
gh issue list --repo consuelo-c/erp-app --milestone "Phase NN" --state all
gh issue list --repo consuelo-c/erp-app --state open --search "no:milestone"
```

An issue that already exists is never proposed again. Unplaced ideas that belong to Phase NN get a `gh issue edit --milestone "Phase NN"` line in the issue script (section 6).

## 4. Screens

Follow "Opening a phase" → "Screens first". Read the [canvas](https://claude.ai/artifact/TBE5f1FaBxQJxkKwncJspg) with the Artifact tool: its page list, `project/compat.json`, then the pages that hold the phase's screens, found by name (`project/_ds/`, `project/uploads/` and `project/old/` aren't screens). Report each screen as **ready**, **missing** or **contradicting the current planning**, and write the design prompt for each one that isn't ready; the developer runs it in the canvas's editor, in Claude. Units are proposed only once the developer says every screen is ready.

## 5. Units

- Every criterion of `acceptance.md` falls in exactly one unit; the "MUST NOT exist" list applies to all of them.
- Each unit fits one short session and leaves the repository coherent.
- Each unit names the units it waits for: the ones whose code it builds on. Keep the edges real; coming later in the list is not waiting.
- A phase with screens ends with the **canvas unit**, «Actualizar el canvas con las pantallas de la Phase NN»: it publishes the phase's canvas pages so they match the code, and waits for every unit that builds a screen.
- Walking the criteria to close the phase is the build run's last step, not a unit.

Show the list (title, criteria covered, what it waits for, order) and wait for approval.

## 6. Issue script

Write `phase-NN-issues.sh` in the session's scratchpad: one `create` per unit, in order, so the issue numbers follow it; then one `waits` per dependency; then the idea placements from section 3. Titles and bodies in Spanish; each body opens with one sentence naming what the unit builds or fixes, so the issue reads on its own, then links the criteria heading and the planning heading it implements, without copying or restating them: a paraphrase drifts from the hard rules and the criteria. Quoted heredocs keep backticks and `$` in the bodies literal.

Planning links are pinned to the commit the session read, so they keep showing the text the issue was written from; `git -C <planning> diff <sha> main -- <file>` shows what changed since. Get it with `git -C <planning> rev-parse --short HEAD` (GitHub resolves the short hash in `blob/` links), after `git -C <planning> fetch` and `git -C <planning> status -sb` show no changes and no `ahead`; otherwise ask the developer to commit and push the planning first.

```bash
#!/usr/bin/env bash
# Phase NN: <n> units + <m> idea placements. Review, then: bash <this file>
set -euo pipefail
R=consuelo-c/erp-app M="Phase NN"

# Creates a Task in the milestone unless one with this exact title exists; body on stdin.
# Prints the issue number either way.
create() {
  local existing
  existing=$(gh issue list --repo "$R" --milestone "$M" --state all --limit 200 \
    --json number,title | jq -r --arg t "$1" '.[] | select(.title == $t) | .number')
  if [ -n "$existing" ]; then
    echo "skip: $1" >&2; cat >/dev/null; echo "$existing"; return
  fi
  gh issue create --repo "$R" --type Task --milestone "$M" --title "$1" --body-file - | rg -o '[0-9]+$'
}

# Records that issue $1 waits for issue $2, as GitHub's native blocked-by dependency
waits() {
  local blocker_id
  blocker_id=$(gh api "repos/$R/issues/$2" --jq .id)
  gh api --method POST "repos/$R/issues/$1/dependencies/blocked_by" -F issue_id="$blocker_id" >/dev/null \
    || echo "edge exists or failed: #$1 waits for #$2" >&2
}

U1=$(create "<título de la unidad>" <<'EOF'
<Una oración: qué construye o arregla la unidad.>

Implementa [`phase-NN/planning.md#<heading>`](https://github.com/consuelo-c/erp-planning/blob/<sha>/phase-NN/planning.md#<heading>).
Criterios: [`phase-NN/acceptance.md#<heading>`](https://github.com/consuelo-c/erp-planning/blob/<sha>/phase-NN/acceptance.md#<heading>).
EOF
)

U2=$(create "<título de una unidad que se apoya en la primera>" <<'EOF'
…
EOF
)

# Dependencies: waits <unit> <the unit it waits for>
waits "$U2" "$U1"

# Ideas placed in this phase
gh issue edit <N> --repo "$R" --milestone "$M"
```

Show the script in full with its absolute path and change it on request. The developer may edit it directly; re-read it before describing or changing it. Once the developer approves it, run it with `bash <path>` (its permission prompt is the approval); if it fails, fix the file and run it again: existing titles are skipped and existing edges reported.

End by telling the developer the phase is ready for `/build-phase NN`, in a session started with `claude --permission-mode dontAsk`.

## 7. Planning findings

A contradiction in the documents is a question for the developer; an error is a `docs` issue, created with its body written out in full.
