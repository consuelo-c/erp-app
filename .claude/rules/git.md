# Git rules

- Branches are `<type>/<issue>-<slug>` (`feat`, `fix`, `chore`, `docs`); a phase's integration branch takes its map's number.
- An implementer makes one commit for its ticket; follow-up commits for the developer's tweaks and `/code-review` fixes are allowed. Every subject ends with an issue number: the ticket's, or the spec's when the commit spans several tickets; one-off work takes its issue's.
- Stage files by name, never `git add -A` or `git add .`.
- Never skip a hook (`--no-verify`): fix the cause and commit again.
