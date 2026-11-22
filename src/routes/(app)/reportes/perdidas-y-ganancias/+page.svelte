<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatPeriod } from '$lib/datetime';
	import { formatBalance, formatPesos } from '$lib/format';
	import type { CashConcept } from '$lib/server/services/cash';
	import type { PageProps } from './$types';

	// The period's money in and out, on cash like Movimientos caja, each line opening the book on
	// its own concepts; and apart from the result, Vendido. A desktop puts the tiles on top and
	// Vendido beside; a phone puts the Resultado card on top and Vendido under «Aparte del resultado».
	let { data }: PageProps = $props();

	const report = $derived(data.report);
	const { income, expenses } = $derived(report);

	type Line = { label: string; amount: number; concepts: CashConcept[]; meta?: string };

	const incomeLines: Line[] = $derived([
		{
			label: 'Recaudado',
			...income.collected,
			meta: 'Pagos − devoluciones de pagos + cargos por cancelación, de pedidos y cuentas de cobro. Sin depósitos.'
		},
		{ label: 'Otros ingresos', ...income.otherIncome },
		{
			label: 'Cobrado por novedades',
			...income.damageCharges,
			meta: countOf(income.damageCharges.orderCount, 'pedido', 'pedidos')
		}
	]);

	const expenseLines: Line[] = $derived([
		{
			label: 'Transporte',
			...expenses.transport,
			meta: `Gastos de transporte ${formatPesos(-expenses.transport.transportExpenses)} · Pagos a transportadores ${formatPesos(-expenses.transport.carrierPayments)}`
		},
		{ label: 'Insumos', ...expenses.supplies },
		{
			label: 'Salarios',
			...expenses.salaries,
			meta: `Nómina · ${countOf(expenses.salaries.weekCount, 'semana', 'semanas')}`
		},
		{ label: 'Arriendo', ...expenses.rent },
		{ label: 'Otros', ...expenses.other }
	]);

	const soldSplit = $derived(
		`Alquiler ${formatPesos(report.sold.rental)} · Transporte ${formatPesos(report.sold.transport)}`
	);

	function countOf(count: number, one: string, many: string): string {
		return `${count} ${1 === count ? one : many}`;
	}

	function cashBookHref(concepts: CashConcept[]): string {
		const query = new URLSearchParams([
			['desde', report.from],
			['hasta', report.to],
			...concepts.map((concept) => ['concepto', concept])
		]);
		return `${resolve('/caja')}?${query}`;
	}

	const ordersHref = $derived(
		`${resolve('/pedidos')}?${new URLSearchParams({ entrega: 'ALL', desde: report.from, hasta: report.to })}`
	);

	function submitOnChange(event: Event & { currentTarget: HTMLFormElement }) {
		event.currentTarget.requestSubmit();
	}
</script>

<svelte:head>
	<title>Pérdidas y ganancias · Banquetes Consuelo C</title>
</svelte:head>

{#snippet lines(items: Line[], format: (pesos: number) => string)}
	{#each items as line (line.label)}
		<li class="detail-list__row--plain">
			<span>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built with resolve() -->
				<a href={cashBookHref(line.concepts)}>{line.label}</a>
				{#if line.meta}
					<div class="meta desktop-only">{line.meta}</div>
				{/if}
			</span>
			<span>{format(line.amount)}</span>
		</li>
	{/each}
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader title="Pérdidas y ganancias" />
	{/snippet}

	<!-- No apply button: a changed date reloads the report. -->
	<form
		class="dates"
		method="GET"
		data-sveltekit-keepfocus
		data-sveltekit-noscroll
		onchange={submitOnChange}
	>
		<Field label="Desde" id="desde">
			<Input id="desde" name="desde" type="date" value={report.from} />
		</Field>
		<Field label="Hasta" id="hasta">
			<Input id="hasta" name="hasta" type="date" value={report.to} />
		</Field>
	</form>
	<p class="meta period desktop-only">
		{formatPeriod(report.from, report.to)} · por fecha del movimiento, como Movimientos caja
	</p>

	<div class="report">
		<div>
			<div class="stat-grid desktop-only">
				<div class="stat stat--income">
					<div class="stat__label">Ingresos</div>
					<div class="stat__value">{formatBalance(income.total)}</div>
				</div>
				<div class="stat stat--expense">
					<div class="stat__label">Gastos</div>
					<div class="stat__value">{formatBalance(-expenses.total)}</div>
				</div>
				<div class="stat">
					<div class="stat__label">Resultado</div>
					<div class="stat__value">{formatBalance(report.result)}</div>
				</div>
			</div>

			<div class="result-card phone-only">
				<Card>
					{#snippet head()}
						<b class="card-title">Resultado</b>
						<b class="result-card__value">{formatBalance(report.result)}</b>
					{/snippet}
					<p class="meta">
						Ingresos {formatBalance(income.total)} · Gastos {formatBalance(-expenses.total)}
					</p>
				</Card>
			</div>

			<h2 class="section-title">Ingresos</h2>
			<ul class="detail-list">
				{@render lines(incomeLines, formatBalance)}
				<li class="detail-list__row--strong desktop-only-row">
					<span>Total ingresos</span><span>{formatBalance(income.total)}</span>
				</li>
			</ul>

			<h2 class="section-title">Gastos</h2>
			<ul class="detail-list">
				{@render lines(expenseLines, formatBalance)}
				<li class="detail-list__row--strong desktop-only-row">
					<span>Total gastos</span><span>{formatBalance(expenses.total)}</span>
				</li>
			</ul>

			<div class="desktop-only">
				<ul class="detail-list result">
					<li class="detail-list__row--strong">
						<span>Resultado</span><span>{formatBalance(report.result)}</span>
					</li>
				</ul>
				<p class="meta result__note">
					Ingresos − gastos. Solo dinero que entró o salió: cuadra con Movimientos caja.
				</p>
			</div>

			<div class="phone-only">
				<h2 class="section-title">Aparte del resultado</h2>
				<ul class="detail-list">
					<li class="detail-list__row--plain">
						<span>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built with resolve() -->
							<a href={ordersHref}>Vendido</a>
							<div class="meta">{soldSplit}</div>
						</span>
						<span>{formatPesos(report.sold.total)}</span>
					</li>
					<!-- STUB: #645 adds the «Pérdidas» row here, with «Sin cobrar» in its meta line. -->
				</ul>
			</div>
		</div>

		<div class="desktop-only">
			<Card>
				{#snippet head()}
					<b class="card-title">Vendido</b>
					<b class="card-value">{formatPesos(report.sold.total)}</b>
				{/snippet}
				<p class="meta sold__note">
					{countOf(report.sold.count, 'pedido', 'pedidos')} con evento en el periodo, sin cancelados,
					pagados o no. No entra en el resultado.
				</p>
				<ul class="detail-list">
					<li class="detail-list__row--plain">
						<span>Alquiler</span><span>{formatPesos(report.sold.rental)}</span>
					</li>
					<li class="detail-list__row--plain">
						<span>Transporte</span><span>{formatPesos(report.sold.transport)}</span>
					</li>
				</ul>
				<div class="sold__action">
					<Button variant="secondary" size="sm" inline href={ordersHref}>Ver pedidos</Button>
				</div>
			</Card>
			<!-- STUB: #645 adds the «Pérdidas» card here, its products and «Sin cobrar» per order. -->
		</div>
	</div>
</Screen>

<style>
	p {
		margin: 0;
	}

	.desktop-only,
	.desktop-only-row {
		display: none;
	}

	.dates {
		display: flex;
		gap: var(--control-gap);
		margin-bottom: var(--space-4);
	}

	.dates > :global(*) {
		flex: 1;
		min-width: 0;
	}

	.result-card {
		margin: var(--space-6) 0 var(--space-9);
	}

	.result-card :global(.card) {
		border: var(--border-w-strong) solid var(--border-strong);
	}

	.card-title {
		font-size: var(--text-md);
	}

	.result-card__value {
		font-size: var(--text-2xl);
	}

	.card-value {
		font-size: var(--text-xl);
	}

	.section-title {
		margin-top: var(--space-9);
	}

	/* Stat tiles: the period's three answers. */
	.stat-grid {
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-4);
		max-width: 720px;
	}

	.stat {
		min-width: 0;
		padding: var(--space-5);
		text-align: center;
		background: var(--surface-subtle);
		border-radius: var(--radius-input);
	}

	.stat__label {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.stat__value {
		font-weight: var(--weight-bold);
	}

	.stat--income .stat__value {
		color: var(--income);
	}

	.stat--expense .stat__value {
		color: var(--expense);
	}

	.result {
		margin-top: var(--space-7);
	}

	.result li {
		font-size: var(--text-lg);
	}

	.result__note {
		margin-top: var(--space-3);
	}

	.sold__note {
		margin: var(--space-1) 0 var(--space-5);
	}

	.sold__action {
		margin-top: var(--space-5);
	}

	@container (width >= 1024px) {
		.phone-only {
			display: none;
		}

		.desktop-only {
			display: block;
		}

		.desktop-only-row {
			display: flex;
		}

		.stat-grid {
			display: grid;
		}

		.dates {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 220px));
		}

		.period {
			margin-bottom: var(--space-9);
		}

		.report {
			display: grid;
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
			gap: var(--space-14);
			align-items: start;
		}
	}
</style>
