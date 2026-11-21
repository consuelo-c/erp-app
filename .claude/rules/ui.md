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
- One primary action per screen: every action goes in one `screen__action` row at the end of the body, the primary last; no fixed footer.
- An action that changes nothing (print, history, copy a link) is an icon in `screen-header__actions`, with its name as tooltip and accessible name.
- Controls the driver or warehouse use are at least 48px tall.
- Status-change buttons read «Marcar como {estado}» and are offered to any employee, never hidden as another role's job.
- Meta lines join their facts with « · ».
- A new icon comes from Lucide (24 grid, 2px stroke) and goes into `static/icons.svg`.
- A form the canvas draws on its own is its own route, never embedded in another screen; a `Modal` only confirms or takes one field (a punch's time), never a whole form.
