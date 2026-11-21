# Payments are recorded only on orders, never on a cuenta de cobro

A cuenta de cobro used to take payments of its own, so a billed order had no Pagado or Saldo: it read its cuenta's balance instead, and every screen showing an order's money needed a second set of rules for billed orders, which drifted apart (the cancelled-and-billed order read differently on the staff detail, the Remisión and Mi pedido). Now every payment is recorded on an order. Paying a cuenta de cobro, which is always for its whole balance, records each of its orders' Saldo as a «Pago» on that order, and a cuenta's balance is the sum of its orders'. One rule reads every order's money, billed or not.

## Consequences

- One bank transfer for a cuenta shows in Caja as one movement per order.
- A billed order still refuses a «Pago» of its own: it's paid only through its cuenta, in full.
- The cuenta's «se paga completa» rule is what makes the split exact: no amount is left to allocate, and there's never an overpayment to place.
