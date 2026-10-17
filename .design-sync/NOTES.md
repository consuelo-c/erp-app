# Design sync notes

- The Design System («Consuelo C Design System») is plain HTML + CSS, maintained by hand: `components/<group>/<group>.css`, `components/<group>/*.card.html` (first line `<!-- @dsCard … -->`), `components/README.md`, `assets/icons.svg`. There is no React bundle and no converter run.
- The app (`src/lib/components/*.svelte`, `src/app.css`, `static/icons.svg`) is the source of truth. A sync is a targeted edit: read the remote file, apply the code's change to it, upload only the files that changed. Never a wholesale replace.
- The Design System keeps `lock` in its sprite although the app doesn't use it yet: planned by the navigation handoff (`uploads/ds-add-icons.md`).
