# Design sync notes

- The Design System («Consuelo C Design System») is plain HTML + CSS, maintained by hand: `components/<group>/<group>.css`, `components/<group>/*.card.html` (first line `<!-- @dsCard … -->`), `components/README.md`, `assets/icons.svg`. There is no React bundle and no converter run.
- The app (`src/lib/components/*.svelte`, `src/app.css`, `static/icons.svg`) is the source of truth. A sync is a targeted edit: read the remote file, apply the code's change to it, upload only the files that changed. Never a wholesale replace.
- The Design System keeps `lock` in its sprite although the app doesn't use it yet: planned by the navigation handoff (`uploads/ds-add-icons.md`).
- `get_file` content only reaches the conversation, not the disk, so edited files are retyped before upload. Check `assets/icons.svg` symbols against `static/icons.svg` before uploading: a retyped path can carry a silent typo.
- The Hint (ⓘ tooltip, `.hint` / `.hint__text`) has no Svelte component: its styles are page-scoped in `src/routes/(app)/horas/equipo/+page.svelte`, and the Design System keeps them in `components/feedback/feedback.css`. Extract a component when a second screen uses it.
- Before uploading a retyped file, diff it against the same file in the latest Design Project export (`../design/_ds/<folder>/`), which mirrors the remote. An identical diff proves the retype; then apply the edits with a script, so the final diff shows only them.
