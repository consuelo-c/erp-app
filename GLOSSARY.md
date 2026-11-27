# Banquetes Consuelo C ERP

The ERP for a party rental business in Medellín. One name per concept: the code, the issues and the chat use these and no synonyms.

## Design

**Brand**:
The company's logo, colors, font, radii, voice and messages, kept in `consuelo-c/branding`. It knows nothing about the app and wins over it.

**Design System**:
The app's own tokens and components, on top of the brand, as the code holds them. It wins over the canvas.
_Avoid_: style guide, UI kit

**Canvas**:
The Claude artifact "Consuelo C ERP Canvas", where the screens and printouts are drawn.
_Avoid_: mockups, design file

**Page**:
A canvas file of kind `page`, one per section of the app, found by its name.
_Avoid_: canvas screen

**Frame**:
One drawn screen or state on a page.
_Avoid_: artboard

**Screen**:
One route of the app, drawn in one or more frames.

**Printout**:
A printed sheet (order, quote, receipt, payroll slip), drawn in frames like a screen.

## Orders and quotes

**Priced document**:
A quote or an order: a client's snapshot, its lines at frozen prices, and the totals they make. An order adds its trips, its money and its status; a quote adds its validity.

## Money

**Cuenta de cobro**:
A bill grouping one client's orders, paid in one payment for its whole balance. It holds no money of its own: its payment is recorded on each of its orders.
_Avoid_: invoice

**Pagado**:
What an order's client has paid on it, net of what was given back. The deposit isn't in it.

**Saldo**:
What an order's client still owes: its total less Pagado.

**A favor del cliente**:
What the company holds for the client of a cancelled order: Pagado plus the deposit received. Every reader, the client included, sees it under this name.
_Avoid_: Saldo a favor, Saldo a su favor

**Entrega de efectivo**:
Cash a driver or Sales rep hands to the manager, recorded by the manager as received. It moves the company's own cash from a pocket to the drawer, so it isn't income or expense.
_Avoid_: reconciliation, settlement

**Efectivo por entregar**:
The cash a driver or Sales rep is holding for the company: the cash they've collected, less the cash they've given back, less the expenses they paid out of it, less their entregas de efectivo. The manager and admin don't have one: they are the drawer.
_Avoid_: cash on hand, running balance

**Vendido**:
What the company sold in a period: the totals of the orders whose party falls in it, paid or not, cancelled ones left out. Split into rental and transport.
_Avoid_: ventas, facturado

**Recaudado**:
What the company's clients paid it in a period, net of what it gave back, cancellation fees included and deposits left out. Not split into rental and transport.
_Avoid_: ingresos, cobrado

**Gastos**:
What the company paid out in a period to run itself, in five categories: Transporte (carriers included), Insumos, Salarios, Arriendo and Otros. Refunds and deposits given back aren't gastos.
_Avoid_: egresos, costos

**Cobro por novedad**:
What a client pays the company for an order's incidents, in new money or kept from the deposit. It isn't in Pagado and doesn't lower the Saldo; in a period it's counted apart from Recaudado.
_Avoid_: multa, penalty, damage fee

**Pérdidas**:
The replacement cost of the products an order's incidents left lost or unrecoverable, counted in a period whoever was responsible. Not cash, so not part of the result; what a client was responsible for and hasn't paid of it is «Sin cobrar».
_Avoid_: mermas, daños

**Money statement**:
The rows an order's money reads as (Total, Pagado, Saldo or A favor del cliente, its cuenta de cobro, the deposit agreed and received, what was charged for its incidents), the same for every reader.

## Inventory

**Count**:
A partial physical count of what the company owns, sent by whoever counted it and applied to the inventory only when the manager or admin approves it.
_Avoid_: stocktake, audit

**Corrected quantity**:
The quantity the reviewer sets on a counted product before approving its count, applied instead of what was counted. What the counter sent stays on the count beside it. Shown as «Corregido».
_Avoid_: approved quantity, adjusted quantity

**Incident**:
Damage or loss found on an order's return, each product with what happened to it (lost, unrecoverable, recoverable). Whoever reported it can correct or reverse it until the manager sets who is responsible; from then on only the manager can reverse it. Shown as «Novedad».
_Avoid_: pickup event, damage report

**Costo de reposición**:
What it costs the company to replace one unit of a product, set in the catalog. It values losses, never what a client is charged.
_Avoid_: costo, precio de compra

**Sub-lending**:
Renting from another rental business the products the company is short of for a period, when its orders hold more of a product on some day than the company owns. Shown as «Subalquiler».
_Avoid_: borrowing, «préstamo»

## Audit

**Event**:
The record of one change to a record, or one access to the app, by whom and when: what was saved, never edited or deleted. Listed in the «Auditoría» report; never the client's party, which is what «evento» means to the company's staff and clients.
_Avoid_: log, history, «evento» in the UI

**Launch**:
The first real order taken in production. From then on, production data is the company's record and is never deleted or truncated.
_Avoid_: go-live, release
