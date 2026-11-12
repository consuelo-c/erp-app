<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { formatSpelledDate } from '$lib/datetime';
	import { formatBalance, formatIdNumber, formatPesos } from '$lib/format';
	import { formatRemisiones, splitOrdersIntoPages } from '$lib/orders';
	import type { PrintedOrder } from '$lib/server/services/receivables';
	import { printedContact } from '$lib/whatsapp';
	import type { PageProps } from './$types';

	// Outside the app's shell, the letter sheets that copy the company's paper. The fixed texts are
	// the template's, not settings: changing one is a code change.
	let { data }: PageProps = $props();

	const printout = $derived(data.printout);
	const client = $derived(printout.client);
	const company = $derived(printout.company);
	const contact = $derived(printedContact(client.phone, client.whatsapp));
	// Cancelled orders aren't in `orders`: an «Anulada» cuenta prints no order block at all.
	const title = $derived(`CUENTA DE COBRO Nº ${printout.id}${printout.isVoid ? ' — ANULADA' : ''}`);
	const isSingleOrder = $derived(1 === printout.orders.length);
	// What was paid follows the last total; an «Anulada» cuenta prints no total, so nothing follows.
	const hasPayments = $derived(0 !== printout.paid && 0 < printout.orders.length);
	const pages = $derived(splitOrdersIntoPages(printout.orders, hasPayments ? 2 : 0));
	// As on the paper, a single order's totals sit beside the bank account, unless the closing went
	// to a sheet of its own: then they stay under the order's last line.
	const hasTotalsInClosing = $derived(
		isSingleOrder && pages[pages.length - 1].some((block) => block.isClosed)
	);
</script>

<svelte:head>
	<title>Cuenta de cobro Nº {printout.id} · {company.COMPANY_NAME}</title>
</svelte:head>

{#snippet field(label: string, value: string)}
	<div class="print-field"><span>{label}</span><span>{value}</span></div>
{/snippet}

{#snippet totals(order: PrintedOrder)}
	<div class="print-totals">
		<div class="print-row"><span>SUBTOTAL</span><span>{formatPesos(order.itemsTotal)}</span></div>
		<div class="print-row"><span>NÚMERO DE DÍAS</span><span>{order.rentalDays}</span></div>
		<div class="print-row">
			<span>DESCUENTO</span><span>{formatBalance(-order.discount)}</span>
		</div>
		<div class="print-row">
			<span>TRANSPORTE</span><span>{formatPesos(order.transportCost)}</span>
		</div>
		<div class="print-row print-row--strong">
			<span>TOTAL</span><span>{formatPesos(order.orderTotal)}</span>
		</div>
		{#if isSingleOrder}
			{@render payments()}
		{/if}
	</div>
{/snippet}

{#snippet payments()}
	{#if hasPayments}
		<div class="print-row"><span>ABONOS</span><span>{formatBalance(printout.paid)}</span></div>
		<div class="print-row print-row--strong">
			<span>SALDO A PAGAR</span><span>{formatBalance(printout.balance)}</span>
		</div>
	{/if}
{/snippet}

{#snippet opening()}
	<div class="print-client">
		<div class="print-field">
			<span>Señores:</span><span class="print-client__name">{client.name}</span>
		</div>
		{#if null !== client.documentId}
			{@render field('NIT/C.C.', formatIdNumber(client.documentId))}
		{/if}
		{@render field('Dirección', client.address)}
		{@render field(contact.label, contact.value)}
	</div>
	{#if 0 < printout.orders.length}
		{@render field('Concepto:', formatRemisiones(printout.orders.map(({ id }) => id)))}
	{/if}
	{@render field('Debe a:', company.COMPANY_NAME)}
	{@render field('Forma de pago:', printout.paymentTerms)}
{/snippet}

{#snippet closing()}
	<div class="print-payment">
		<div>
			<div>
				Cuenta de Ahorros<br />Bancolombia<br />N° 10282345377<br />Consuelo E. Cifuentes V.
			</div>
			<div class="signature signature--payment">&nbsp;</div>
		</div>
		{#if hasTotalsInClosing}
			{@render totals(printout.orders[0])}
		{:else if 1 < printout.orders.length}
			<div class="print-totals print-totals--grand">
				<div class="print-row print-row--strong">
					<span>TOTAL A PAGAR</span><span>{formatPesos(printout.total)}</span>
				</div>
				{@render payments()}
			</div>
		{/if}
	</div>
	<div class="print-texts">
		<div>
			Extienda todos los cheques pagaderos a: Banquetes Consuelo C. y/o Consuelo E. Cifuentes V.
			NIT: 21.362.043 - 6
		</div>
		<div class="print-texts__regime">RÉGIMEN SIMPLIFICADO</div>
		<div>
			NOTA. Esta cuenta de cobro se asimila en todos sus efectos legales a la letra de cambio, según
			artículo 772 a 774 del código de comercio.
		</div>
		<div>
			Mercancía real y materialmente entregada y recibida por el comprador a entera satisfacción.
		</div>
	</div>
	<div class="print-spacer"></div>
	<div class="print-company">
		<div class="signature">&nbsp;</div>
		<div class="print-small">{company.COMPANY_ADDRESS} · {company.COMPANY_PHONE}</div>
	</div>
{/snippet}

<div class="printout">
	<div class="printout__toolbar">
		<Button
			href={resolve('/(app)/cuentas-de-cobro/[id]', { id: String(printout.id) })}
			variant="secondary"
			size="sm"
			inline
		>
			Volver a la cuenta de cobro
		</Button>
		<Button type="button" size="sm" inline onclick={() => window.print()}>Imprimir</Button>
	</div>

	{#each pages as blocks, index (index)}
		{@const isLastPage = pages.length - 1 === index}
		<article class="print-sheet">
			<header class="print-head">
				<img
					class="print-head__logo"
					src="/banquetes-consuelo-c-logo.svg"
					alt={company.COMPANY_NAME}
				/>
				{#if 1 < pages.length}
					<div class="print-small print-page">{index + 1} de {pages.length}</div>
				{/if}
			</header>

			{#if 0 === index}
				<div class="print-date">Medellín, {formatSpelledDate(printout.issueDate)}</div>
			{/if}
			<h1 class="print-title">{title}</h1>
			{#if 0 === index}
				{@render opening()}
			{/if}

			{#each blocks as block (block.order.id)}
				<section class="print-block">
					{#if !isSingleOrder}
						<div class="print-block__title">Remisión {block.order.id}</div>
					{/if}
					<table class="print-table">
						<thead>
							<tr>
								<th>DESCRIPCIÓN</th>
								<th class="num print-table__quantity">CANTIDAD</th>
								<th class="num print-table__price">VR. UNIDAD</th>
								<th class="num print-table__total">VR. TOTAL</th>
							</tr>
						</thead>
						<tbody>
							{#each block.items as item (item.product_id)}
								<tr>
									<td>{item.name}</td>
									<td class="num">{item.qty}</td>
									<td class="num">{formatPesos(item.unit_price)}</td>
									<td class="num">{formatPesos(item.line_total)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if block.isClosed && !hasTotalsInClosing}
						{@render totals(block.order)}
					{/if}
				</section>
			{/each}

			{#if isLastPage}
				{@render closing()}
			{:else}
				<div class="print-spacer"></div>
				<div class="print-small print-continues">Continúa en la hoja {index + 2}</div>
			{/if}
		</article>
	{/each}
</div>

<style>
	/* Letter portrait, edge to edge: the sheet carries its own margins. */
	@page {
		size: letter;
		margin: 0;
	}

	.printout {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		align-items: center;
		min-height: 100vh;
		padding: var(--space-10) var(--screen-pad-x);
		background: var(--surface-subtle);
	}

	.printout__toolbar {
		display: flex;
		gap: var(--control-gap);
		justify-content: space-between;
		width: 816px;
		max-width: 100%;
	}

	/* Every height below adds up to the lines `LETTER_SHEET` counts, in `$lib/orders`. */
	.print-sheet {
		box-sizing: border-box;
		display: flex;
		flex: none;
		flex-direction: column;
		width: 816px;
		height: 1056px;
		padding: 52px 64px;
		font: var(--weight-regular) 12px / 1.3 var(--font-sans);
		color: var(--text-body);
		background: var(--neutral-0);
		box-shadow: var(--shadow-paper);
	}

	.print-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
	}

	.print-head__logo {
		display: block;
		width: 190px;
		height: auto;
	}

	.print-small {
		font-size: var(--print-sm);
		color: var(--text-secondary);
	}

	.print-page {
		font-weight: var(--weight-bold);
	}

	.print-date {
		margin-top: var(--space-8);
	}

	.print-title {
		margin: 12px 0;
		font: var(--weight-bold) 16px var(--font-sans);
		text-align: center;
		letter-spacing: 0.02em;
	}

	.print-field {
		display: grid;
		grid-template-columns: 110px 1fr;
		gap: 12px;
		margin-bottom: 3px;
	}

	.print-field > :first-child {
		color: var(--text-secondary);
	}

	.print-client {
		margin-bottom: 8px;
	}

	.print-client__name {
		font-weight: var(--weight-bold);
	}

	.print-block {
		margin-top: 12px;
	}

	.print-block__title {
		padding-bottom: 3px;
		font-size: var(--print-lg);
		font-weight: var(--weight-bold);
	}

	/* Tighter than the half-letter sheets' table: three orders of 15 lines fit on two sheets. */
	.print-table {
		width: 100%;
		margin-bottom: 2px;
		font-size: var(--print-md);
		line-height: 13px;
		border-collapse: collapse;
	}

	.print-table th {
		padding: 1px 5px;
		font-size: var(--print-xs);
		font-weight: var(--weight-bold);
		color: var(--text-secondary);
		text-align: left;
		border-bottom: var(--border-w) solid var(--border-strong);
	}

	.print-table td {
		padding: 1px 5px;
		vertical-align: top;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.print-table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}

	.print-table__quantity {
		width: 80px;
	}

	.print-table__price {
		width: 100px;
	}

	.print-table__total {
		width: 110px;
	}

	.print-totals {
		flex: none;
		width: 260px;
		margin-left: auto;
		font-size: var(--print-base);
	}

	.print-totals--grand {
		padding-top: var(--space-4);
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.print-row {
		display: flex;
		justify-content: space-between;
		margin-bottom: 1px;
	}

	.print-row > :first-child {
		color: var(--text-secondary);
	}

	.print-row--strong {
		font-size: var(--print-lg);
		font-weight: var(--weight-bold);
	}

	.print-row--strong > :first-child {
		color: inherit;
	}

	.print-payment {
		display: flex;
		gap: 32px;
		align-items: flex-start;
		justify-content: space-between;
		margin-top: 10px;
	}

	.print-texts {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 12px;
		font-size: var(--print-md);
	}

	.print-texts__regime {
		font-weight: var(--weight-bold);
	}

	.print-company {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	/* Blank lines signed by hand: never sacrificed for space. */
	.signature {
		flex: none;
		width: 300px;
		padding-top: var(--space-2);
		border-top: var(--border-w-hair) solid var(--border-strong);
	}

	.signature--payment {
		width: 240px;
		margin-top: 36px;
	}

	.print-spacer {
		flex: 1;
	}

	.print-continues {
		text-align: right;
	}

	@media print {
		.printout {
			display: block;
			min-height: 0;
			padding: 0;
			background: none;
		}

		.printout__toolbar {
			display: none;
		}

		.print-sheet {
			box-shadow: none;
		}

		.print-sheet + .print-sheet {
			break-before: page;
		}
	}
</style>
