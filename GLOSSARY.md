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

**Component page**:
A canvas file of kind `component` that pages embed. Not a Svelte component.

**Frame**:
One drawn screen or state on a page.
_Avoid_: artboard

**Frame ID**:
A frame's label, `<page>-<frame>` with two digits each (`07-12` is page 07's twelfth frame); a new frame takes its page's next free number.

**Design-system copy**:
The Design System as frozen into the canvas, under `project/_ds/`. Where it disagrees with the brand or the code, it loses.

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

**Money statement**:
The rows an order's money reads as (Total, Pagado, Saldo or A favor del cliente, its cuenta de cobro, the deposit agreed and received), the same for every reader.
