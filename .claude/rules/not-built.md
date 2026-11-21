---
paths:
  - 'src/**'
  - 'migrations/**'
---

# Never built

- No VAT or tax fields, no email password recovery, no dark theme.
- No PDF library: printing is CSS (`@page`).
- No separate carrier, provider or employee-identity table: providers are `contacts` with `services`, an employee is a contact. What the company pays a carrier is a `CARRIER_PAYMENT` outflow, never subtracted from the order total.
- Nothing in [`erp-planning:deferred.md`](https://github.com/consuelo-c/erp-planning/blob/main/deferred.md): no table, column, route, key or dependency for it.
