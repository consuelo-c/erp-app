# Git rules

- Branches are `<type>/<issue>-<slug>` (`feat`, `fix`, `chore`, `docs`); a phase's integration branch takes its map's number.
- One commit per ticket, its number at the end of the subject.
- Stage files by name, never `git add -A` or `git add .`.
- Never skip a hook (`--no-verify`): fix the cause and commit again.
