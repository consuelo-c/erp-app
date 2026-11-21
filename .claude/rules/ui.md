---
paths:
  - 'src/**/*.svelte'
  - 'src/app.css'
---

# UI rules

- No raw enum value reaches the screen: every one goes through `src/lib/labels.ts`.
- Every screen with an edit form mounts `UnsavedChangesGuard`; one-field forms inside a `Modal` are exempt.
- `{@html}` only takes the output of `renderHelp` or `renderTerms` (`src/lib/server/markdown.ts`).
- The brand (logo, colors, font, radii, voice, messages) lives in [`consuelo-c/branding`](https://github.com/consuelo-c/branding) and the code copies it: when they disagree, the brand wins and the code is fixed. A brand change is made there first, only when the developer asks.
- When the code and the Design System ([`erp-planning:design/`](https://github.com/consuelo-c/erp-planning/tree/main/design)) disagree, the code wins.
