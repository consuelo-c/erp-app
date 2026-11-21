---
paths:
  - 'src/**'
---

# Code rules

- Names say what the thing is or does, with no abbreviations (`order`, not `ord`); booleans read as questions (`isFrozen`, `hasRole`, `canEdit`).
- No flag arguments: `saveDraft(order)` and `submitOrder(order)`, not `save(order, true)`.
- A compound condition becomes a named predicate: `if (isPayrollLocked(period, settlement, actor))`.
- Command-query separation: a function either changes state or returns a value, not both.
- Comments say why, never what.
- Something another ticket or phase owns gets a stub, marked with a `STUB:` comment naming the issue or phase that replaces it, and an open issue for it in that milestone.
- A skill that reviews or trims code (ponytail) loses to the spec: ask before cutting anything the spec asks for, and never delete a marked stub.
