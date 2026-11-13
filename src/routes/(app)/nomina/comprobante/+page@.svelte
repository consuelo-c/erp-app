<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { formatLongDay, formatShortDay } from '$lib/datetime';
	import { formatIdNumber, formatPesos } from '$lib/format';
	import { DEDUCTION_LABELS, EARNING_LABELS } from '$lib/labels';
	import type { PageProps } from './$types';

	// Outside the app's shell: the landscape half-letter sheet the worker signs, and what prints is
	// the sheet, as it's seen.
	let { data }: PageProps = $props();

	const { draft, payment, company, periodStart, periodEnd } = $derived(data.receipt);
	const backHref = $derived(
		`${resolve('/(app)/nomina')}?${new URLSearchParams({
			empleado: String(draft.employeeId),
			semana: periodStart
		})}`
	);

	// Hours rows carry the hours log's value; the rest count days. The bonus is only an amount.
	function formatQuantity(qty: number | null, derivedQty: number | null): string {
		if (null === qty) {
			return '';
		}
		return `${Math.round(qty * 100) / 100} ${null === derivedQty ? 'd' : 'h'}`;
	}
</script>

<svelte:head>
	<title>Comprobante de nómina · {payment.employeeName} · Banquetes Consuelo C</title>
</svelte:head>

<div class="receipt">
	<div class="receipt__toolbar">
		<Button href={backHref} variant="secondary" size="sm" inline>Volver a la liquidación</Button>
		<Button type="button" size="sm" inline onclick={() => window.print()}>Imprimir</Button>
	</div>

	<article class="print-sheet">
		<header class="print-head">
			<img
				class="print-head__logo"
				src="/banquetes-consuelo-c-logo.svg"
				alt={company.COMPANY_NAME}
			/>
			<div class="print-head__company">
				<div class="print-head__title">PAGO DE NÓMINA · SEMANA {draft.weekNumber}</div>
				<div class="print-small">{company.COMPANY_ADDRESS} · {company.COMPANY_PHONE}</div>
			</div>
		</header>
		<div class="print-small print-page">1 de 1</div>

		<div class="print-band">
			<div>
				<div class="print-row"><span>Nombre</span><span>{payment.employeeName}</span></div>
				<div class="print-row">
					<span>Cédula</span><span>{formatIdNumber(payment.employeeIdNumber)}</span>
				</div>
				<div class="print-row">
					<span>Cargo</span><span>{payment.employeePosition ?? '—'}</span>
				</div>
			</div>
			<div>
				<div class="print-row">
					<span>Fecha de pago</span><span>{formatLongDay(draft.paymentDate)}</span>
				</div>
				<div class="print-row print-row--strong">
					<span>Periodo</span>
					<span>{formatShortDay(periodStart)} – {formatLongDay(periodEnd)}</span>
				</div>
			</div>
		</div>

		<div class="print-band">
			<div>
				<table class="print-table">
					<thead>
						<tr><th>DEVENGADOS</th><th class="num">Cant.</th><th class="num">Valor</th></tr>
					</thead>
					<tbody>
						{#each draft.earnings as line (line.concept)}
							<tr>
								<td>{EARNING_LABELS[line.concept]}</td>
								<td class="num">{formatQuantity(line.qty, line.derivedQty)}</td>
								<td class="num">{formatPesos(line.amount)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<div class="print-row print-row--strong">
					<span>Total devengado</span><span>{formatPesos(draft.totalEarnings)}</span>
				</div>
			</div>
			<div>
				<table class="print-table">
					<thead>
						<tr><th>DEDUCCIONES</th><th class="num">Valor</th></tr>
					</thead>
					<tbody>
						{#each draft.deductions as line (line.concept)}
							<tr>
								<td>
									{DEDUCTION_LABELS[line.concept]}
									{#if line.description}<div class="print-small">{line.description}</div>{/if}
								</td>
								<td class="num">{formatPesos(line.amount)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<div class="print-row print-row--strong">
					<span>Total deducciones</span><span>{formatPesos(draft.totalDeductions)}</span>
				</div>
			</div>
		</div>

		<div class="print-spacer"></div>

		<div class="print-band print-close">
			<div class="print-net">
				<span>Neto a pagar</span><span class="print-net__amount">{formatPesos(draft.netPay)}</span>
			</div>
			<div>
				<p class="print-received">
					Recibí a satisfacción el pago de la liquidación arriba descrita.
				</p>
				<div class="signature">
					Firma del trabajador · C.C. {formatIdNumber(payment.employeeIdNumber)}
				</div>
				<div class="print-small print-prepared">Elaboró: {payment.preparedBy}</div>
			</div>
		</div>
	</article>
</div>

<style>
	/* Half-letter landscape, edge to edge: the sheet carries its own margins. */
	@page {
		size: 8.5in 5.5in;
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
		align-items: center;
		justify-content: space-between;
		width: var(--print-sheet-w);
		max-width: 100%;
	}

	.print-sheet {
		position: relative;
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
		margin-bottom: var(--space-5);
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

	.print-small {
		font-size: var(--print-sm);
		color: var(--text-secondary);
	}

	/* In the sheet's margin: it never takes a row. */
	.print-page {
		position: absolute;
		right: 26px;
		bottom: 6px;
	}

	.print-band {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0 var(--space-14);
		align-items: start;
	}

	.print-band .print-row > :last-child {
		max-width: 240px;
	}

	.print-close {
		align-items: end;
		margin-top: var(--space-6);
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
		font-weight: var(--weight-bold);
	}

	.print-row--strong > :first-child {
		color: inherit;
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

	.print-net {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 12px;
		font-weight: var(--weight-bold);
	}

	.print-net__amount {
		font-size: var(--print-amount);
		font-variant-numeric: tabular-nums;
	}

	.print-spacer {
		flex: 1;
	}

	.print-received {
		margin: 0 0 72px;
		font-size: var(--print-md);
	}

	/* The signature line is never sacrificed for space. */
	.signature {
		width: 100%;
		padding-top: var(--space-2);
		font-size: var(--print-sm);
		color: var(--text-secondary);
		border-top: var(--border-w-hair) solid var(--border-strong);
	}

	.print-prepared {
		margin-top: var(--space-4);
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
