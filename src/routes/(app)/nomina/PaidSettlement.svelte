<script lang="ts">
	import Notice from '$lib/components/Notice.svelte';
	import { formatLongDay, formatShortDay } from '$lib/datetime';
	import { formatPesos } from '$lib/format';
	import { DEDUCTION_LABELS, EARNING_LABELS, PAYMENT_METHOD_LABELS } from '$lib/labels';
	import type { Draft, Payment, PayrollWeek } from '$lib/server/services/payroll';

	// A paid settlement: what was stored and how it was paid, read-only. Nothing here can change it.
	interface Props {
		week: PayrollWeek;
		draft: Draft;
		payment: Payment;
	}

	let { week, draft, payment }: Props = $props();

	const formatQuantity = (qty: number) => String(Math.round(qty * 100) / 100);
	const isCorrected = (qty: number | null, derivedQty: number | null) =>
		null !== derivedQty && qty !== derivedQty;
	const isContribution = (concept: string) => 'PENSION' === concept || 'HEALTH' === concept;
</script>

<Notice tone="success">
	Pagada el {formatLongDay(payment.movementDate)} por {payment.recordedBy}. Esta liquidación está
	cerrada y es definitiva.
</Notice>

<ul class="detail-list paid__facts">
	<li>
		<span>Empleado</span>
		<span
			>{payment.employeeName}{payment.employeePosition
				? ` — ${payment.employeePosition}`
				: ''}</span
		>
	</li>
	<li><span>Semana</span><span>{draft.weekNumber}</span></li>
	<li>
		<span>Periodo salarial</span>
		<span>{formatShortDay(week.periodStart)} – {formatLongDay(week.periodEnd)}</span>
	</li>
	<li>
		<span>Horas extras que paga</span>
		<span>{formatShortDay(week.extraHours.start)} – {formatShortDay(week.extraHours.end)}</span>
	</li>
	<li><span>Fecha de pago</span><span>{formatLongDay(draft.paymentDate)}</span></li>
</ul>

<table class="table">
	<thead>
		<tr><th>DEVENGADOS</th><th class="num">Cant.</th><th class="num">Valor</th></tr>
	</thead>
	<tbody>
		{#each draft.earnings as line (line.concept)}
			<tr>
				<td>
					{EARNING_LABELS[line.concept]}
					{#if isCorrected(line.qty, line.derivedQty)}
						<div class="meta">calculado: {formatQuantity(line.derivedQty ?? 0)} h</div>
					{/if}
				</td>
				<td class="num">
					{#if null === line.qty}—{:else}{formatQuantity(line.qty)}
						{null === line.derivedQty ? 'd' : 'h'}{/if}
				</td>
				<td class="num">{formatPesos(line.amount)}</td>
			</tr>
		{/each}
	</tbody>
	<tfoot>
		<tr>
			<td colspan="2">Total devengado</td>
			<td class="num">{formatPesos(draft.totalEarnings)}</td>
		</tr>
	</tfoot>
</table>

<table class="table">
	<thead>
		<tr><th>DEDUCCIONES</th><th class="num">Cant.</th><th class="num">Valor</th></tr>
	</thead>
	<tbody>
		{#each draft.deductions as line (line.concept)}
			<tr>
				{#if isContribution(line.concept)}
					<td>{DEDUCTION_LABELS[line.concept]}</td>
					<td class="num">
						{'PENSION' === line.concept
							? draft.parameters.PAYROLL_PENSION_RATE
							: draft.parameters.PAYROLL_HEALTH_RATE} %
					</td>
				{:else}
					<td colspan="2">
						{DEDUCTION_LABELS[line.concept]}
						{#if line.description}<div class="meta">{line.description}</div>{/if}
					</td>
				{/if}
				<td class="num">{formatPesos(line.amount)}</td>
			</tr>
		{/each}
	</tbody>
	<tfoot>
		<tr>
			<td colspan="2">Total deducciones</td>
			<td class="num">{formatPesos(draft.totalDeductions)}</td>
		</tr>
	</tfoot>
</table>

<div class="summary-row summary-row--net">
	<span>Neto a pagar</span><span>{formatPesos(draft.netPay)}</span>
</div>

<h2 class="section-title paid__title">Pago</h2>
<ul class="detail-list">
	<li>
		<span>Medio de pago</span>
		<span>{PAYMENT_METHOD_LABELS[payment.method]}{payment.notes ? ` — ${payment.notes}` : ''}</span>
	</li>
	{#if payment.bankAccount}
		<li><span>Cuenta</span><span>{payment.bankAccount}</span></li>
	{/if}
	<li><span>Valor pagado</span><span>{formatPesos(payment.amount)}</span></li>
</ul>

<style>
	.paid__facts {
		margin-top: var(--space-8);
	}

	.paid__title {
		margin: var(--space-12) 0 var(--space-6);
	}

	.detail-list {
		padding: 0;
		margin: 0;
		list-style: none;
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.detail-list > li {
		box-sizing: border-box;
		display: flex;
		gap: var(--space-6);
		align-items: center;
		justify-content: space-between;
		min-height: var(--tap-min);
		font-size: var(--text-base);
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.detail-list > li > :last-child {
		font-weight: var(--weight-semibold);
		text-align: right;
	}

	.table {
		width: 100%;
		margin-top: var(--space-12);
		font-size: var(--text-md);
		border-collapse: collapse;
	}

	.table th {
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-label);
		font-weight: var(--weight-bold);
		color: var(--text-secondary);
		text-align: left;
		border-bottom: var(--border-w-strong) solid var(--border-strong);
	}

	.table td {
		padding: var(--space-4);
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.table tfoot td {
		font-weight: var(--weight-bold);
		border-top: var(--border-w-strong) solid var(--border-strong);
		border-bottom: 0;
	}

	.table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}

	.summary-row--net {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		justify-content: space-between;
		padding: var(--space-10) var(--space-12);
		margin-top: var(--space-12);
		font-weight: var(--weight-semibold);
		line-height: 1.2;
		color: var(--text-body);
		background: var(--surface-highlight);
		border: var(--border-w-strong) solid var(--brand-yellow);
		border-radius: var(--radius-net);
	}

	.summary-row--net > :last-child {
		font: var(--type-net);
	}
</style>
