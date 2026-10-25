<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { formatLongDay } from '$lib/datetime';
	import { formatPesos, formatPesosInWords, formatReceiptNumber } from '$lib/format';
	import { CASH_CONCEPT_LABELS, PAYMENT_METHOD_LABELS } from '$lib/labels';
	import type { PageProps } from './$types';

	// Outside the app's shell: the quarter-letter sheet, one template whose title follows the sign.
	// An offsetting movement prints by its own sign: correcting an egreso prints a recibo.
	let { data }: PageProps = $props();

	const { movement, company } = $derived(data.receipt);
	const isInflow = $derived(0 < movement.amount);
	const title = $derived(isInflow ? 'RECIBO DE CAJA' : 'COMPROBANTE DE EGRESO');
	// Sales came from the order: Caja isn't theirs.
	const backsToOrder = $derived(!data.opensCashBook && null !== movement.orderId);
	const backHref = $derived(
		backsToOrder
			? resolve('/(app)/pedidos/[id]', { id: String(movement.orderId) })
			: `${resolve('/(app)/caja')}?${new URLSearchParams({ movimiento: String(movement.id) })}`
	);
	// A PAYROLL movement names its week; a standalone one, its description.
	const concept = $derived(
		null === movement.weekNumber
			? (movement.description ?? CASH_CONCEPT_LABELS[movement.concept])
			: `Pago de nómina · semana ${movement.weekNumber}`
	);
</script>

<svelte:head>
	<title>
		{isInflow ? 'Recibo de caja' : 'Comprobante de egreso'} # {formatReceiptNumber(
			movement.receiptNumber
		)} · {company.COMPANY_NAME}
	</title>
</svelte:head>

<div class="receipt">
	<div class="receipt__toolbar">
		<Button href={backHref} variant="secondary" size="sm" inline>
			{backsToOrder ? 'Volver al pedido' : 'Volver al movimiento'}
		</Button>
		<Button type="button" size="sm" inline onclick={() => window.print()}>Imprimir</Button>
	</div>

	<article class="print-sheet">
		<header class="print-head">
			<div>
				<img
					class="print-head__logo"
					src="/banquetes-consuelo-c-logo.svg"
					alt={company.COMPANY_NAME}
				/>
				<div class="print-small">{company.COMPANY_ADDRESS} · {company.COMPANY_PHONE}</div>
			</div>
			<div class="print-head__title">
				<div>{title}</div>
				<div class="print-head__number"># {formatReceiptNumber(movement.receiptNumber)}</div>
			</div>
		</header>

		<div class="print-row">
			<span>Fecha</span><span>{formatLongDay(movement.movementDate)}</span>
		</div>
		<div class="print-row">
			<span>{isInflow ? 'Recibido de' : 'Pagado a'}</span>
			<span>{movement.employeeName ?? movement.payee ?? ''}</span>
		</div>
		<div class="print-row"><span>Concepto</span><span>{concept}</span></div>
		{#if null !== movement.orderId}
			<div class="print-row"><span>Pedido relacionado</span><span>#{movement.orderId}</span></div>
		{/if}
		<div class="print-row">
			<span>Método de pago</span>
			<span>{movement.otherMethod ?? PAYMENT_METHOD_LABELS[movement.method]}</span>
		</div>

		<div class="print-amount">
			<div class="print-row print-row--strong">
				<span>Valor</span>
				<span class="print-amount__number">{formatPesos(Math.abs(movement.amount))}</span>
			</div>
			<div class="print-small print-amount__words">{formatPesosInWords(movement.amount)}</div>
		</div>

		<div class="print-spacer"></div>
		<div class="signature">Recibió · Firma / C.C.</div>
	</article>
</div>

<style>
	/* Quarter-letter, edge to edge: the sheet carries its own margins. */
	@page {
		size: 5.5in 4.25in;
		margin: 0;
	}

	.receipt {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		align-items: center;
		min-height: 100vh;
		padding: var(--space-10) var(--screen-pad-x);
		background: var(--surface-subtle);
	}

	.receipt__toolbar {
		display: flex;
		gap: var(--control-gap);
		justify-content: space-between;
		width: var(--print-sheet-w);
		max-width: 100%;
	}

	/* Half the payroll receipt's half-letter: same width, half the height. */
	.print-sheet {
		box-sizing: border-box;
		display: flex;
		flex: none;
		flex-direction: column;
		width: var(--print-sheet-w);
		height: calc(var(--print-sheet-h) / 2);
		padding: 22px 28px;
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
		padding-bottom: 10px;
		margin-bottom: 12px;
		border-bottom: var(--border-w-strong) solid var(--border-strong);
	}

	.print-head__logo {
		display: block;
		width: 104px;
		height: auto;
		margin-bottom: 6px;
	}

	.print-head__title {
		font-size: 14px;
		font-weight: var(--weight-bold);
		text-align: right;
	}

	.print-head__number {
		margin-top: 3px;
		font-size: 12px;
	}

	.print-small {
		font-size: var(--print-sm);
		color: var(--text-secondary);
	}

	.print-row {
		display: flex;
		gap: var(--space-8);
		justify-content: space-between;
		margin-bottom: 3px;
	}

	.print-row > :first-child {
		color: var(--text-secondary);
	}

	.print-row > :last-child {
		max-width: 320px;
		text-align: right;
	}

	.print-row--strong {
		align-items: baseline;
		font-weight: var(--weight-bold);
	}

	.print-row--strong > :first-child {
		color: inherit;
	}

	.print-amount {
		padding-top: var(--space-4);
		margin-top: 12px;
		border-top: var(--border-w-hair) solid var(--border-default);
	}

	.print-amount__number {
		font-size: 18px;
		font-variant-numeric: tabular-nums;
	}

	.print-amount__words {
		text-align: right;
	}

	.print-spacer {
		flex: 1;
		min-height: 28px;
	}

	/* The signature line is never sacrificed for space. */
	.signature {
		flex: none;
		width: 55%;
		padding-top: var(--space-2);
		font-size: var(--print-sm);
		color: var(--text-secondary);
		border-top: var(--border-w-hair) solid var(--border-strong);
	}

	@media print {
		.receipt {
			display: block;
			min-height: 0;
			padding: 0;
			background: none;
		}

		.receipt__toolbar {
			display: none;
		}

		.print-sheet {
			box-shadow: none;
		}
	}
</style>
