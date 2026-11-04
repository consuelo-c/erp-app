<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import { formatPesos } from '$lib/format';
	import { splitIntoPages } from '$lib/orders';
	import type { OrderItem } from '$lib/server/services/orders';
	import type { CompanySettings } from '$lib/server/services/settings';

	// Outside the app's shell, the half-letter sheets the order and the quote print on: what prints
	// is the sheets. Each repeats the header and numbers itself; `opening` opens the first, the lines
	// follow, and `closing` closes the last, never split from it. The rows the snippets write
	// (`print-row`, `print-group`, …) take their style from here.
	interface Props {
		/** «Pedido #1043», «Cotización #12». */
		title: string;
		company: CompanySettings;
		items: OrderItem[];
		back: { href: string; label: string };
		opening: Snippet;
		closing: Snippet;
	}

	let { title, company, items, back, opening, closing }: Props = $props();

	const pages = $derived(splitIntoPages(items));
</script>

<svelte:head>
	<title>{title} · {company.COMPANY_NAME}</title>
</svelte:head>

<div class="printout">
	<div class="printout__toolbar">
		<Button href={back.href} variant="secondary" size="sm" inline>{back.label}</Button>
		<Button type="button" size="sm" inline onclick={() => window.print()}>Imprimir</Button>
	</div>

	{#each pages as lines, index (index)}
		{@const isLastPage = pages.length - 1 === index}
		<article class="print-sheet">
			<header class="print-head">
				<img
					class="print-head__logo"
					src="/banquetes-consuelo-c-logo.svg"
					alt={company.COMPANY_NAME}
				/>
				<div class="print-head__company">
					<div class="print-head__title">{title}</div>
					<div class="print-small">{company.COMPANY_NAME}</div>
					<div class="print-small">{company.COMPANY_ADDRESS}</div>
					<div class="print-small">{company.COMPANY_PHONE}</div>
					<div class={['print-small', { 'print-page--spills': 1 < pages.length }]}>
						{index + 1} de {pages.length}
					</div>
				</div>
			</header>

			{#if 0 === index}
				{@render opening()}
			{/if}

			{#if lines.length}
				<table class="print-table">
					<thead>
						<tr>
							<th>Producto</th>
							<th class="num">Cant.</th>
							<th class="num">Precio unit.</th>
							<th class="num">Total</th>
						</tr>
					</thead>
					<tbody>
						{#each lines as item (item.product_id)}
							<tr>
								<td>{item.name}</td>
								<td class="num">{item.qty}</td>
								<td class="num">{formatPesos(item.unit_price)}</td>
								<td class="num">{formatPesos(item.line_total)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			<div class="print-spacer"></div>

			{#if isLastPage}
				{@render closing()}
			{:else}
				<div class="print-small print-continues">
					Continúa en la hoja {index + 2} · {items.length} líneas
				</div>
			{/if}
		</article>
	{/each}
</div>

<style>
	/* Half-letter portrait, edge to edge: the sheet carries its own margins. */
	@page {
		size: 5.5in 8.5in;
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
		width: var(--print-sheet-w);
		max-width: 100%;
	}

	.print-sheet {
		box-sizing: border-box;
		display: flex;
		flex: none;
		flex-direction: column;
		width: var(--print-sheet-w);
		height: var(--print-sheet-h);
		padding: 22px 26px;
		font: var(--weight-regular) var(--print-base) / 1.35 var(--font-sans);
		color: var(--text-body);
		background: var(--neutral-0);
		box-shadow: var(--shadow-paper);
	}

	.print-head {
		display: flex;
		gap: var(--space-8);
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: var(--space-7);
	}

	.print-head__logo {
		display: block;
		width: 140px;
		height: auto;
	}

	.print-head__company {
		text-align: right;
	}

	.print-head__title {
		margin-bottom: 3px;
		font-size: var(--print-title);
		font-weight: var(--weight-bold);
	}

	.print-sheet :global(.print-small) {
		font-size: var(--print-sm);
		color: var(--text-secondary);
	}

	.print-page--spills {
		font-weight: var(--weight-bold);
	}

	.print-sheet :global(.print-group) {
		margin-top: var(--space-4);
	}

	.print-sheet :global(.print-row) {
		display: flex;
		gap: var(--space-8);
		justify-content: space-between;
		margin-bottom: 3px;
	}

	.print-sheet :global(.print-row > :first-child) {
		color: var(--text-secondary);
	}

	.print-sheet :global(.print-row > :last-child) {
		max-width: 320px;
		text-align: right;
	}

	.print-sheet :global(.print-row--strong) {
		font-weight: var(--weight-bold);
	}

	.print-sheet :global(.print-row--strong > :first-child) {
		color: inherit;
	}

	.print-sheet :global(.print-total) {
		font-size: var(--print-lg);
	}

	.print-table {
		width: 100%;
		margin: var(--space-5) 0 var(--space-2);
		font-size: var(--print-md);
		border-collapse: collapse;
	}

	.print-table th {
		padding: 3px 5px;
		font-size: var(--print-xs);
		font-weight: var(--weight-bold);
		color: var(--text-secondary);
		text-align: left;
		border-bottom: var(--border-w) solid var(--border-strong);
	}

	.print-table td {
		padding: 3px 5px;
		vertical-align: top;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.print-table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
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
