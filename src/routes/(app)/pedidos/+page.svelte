<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge, { ORDER_STATUS_TONES } from '$lib/components/Badge.svelte';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Input from '$lib/components/Input.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import Select from '$lib/components/Select.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatLongDay, formatPeriod, formatCivilDate } from '$lib/datetime';
	import { formatPesos } from '$lib/format';
	import { DELIVERY_METHOD_LABELS, DELIVERY_PERIOD_LABELS, ORDER_STATUS_LABELS } from '$lib/labels';
	import type { OrderSummary } from '$lib/server/services/orders';
	import type { PageProps } from './$types';

	// Every order by event date, latest first. Cards on a phone, a table from 1024px; the filters in
	// a sheet on a phone and under a toggle on a desktop, as in Caja, both a GET form, so a filtered
	// list is a URL.
	let { data }: PageProps = $props();

	const filters = $derived(data.filters);

	// What narrows the list, as the screen reads it; the event range counts as one filter, and so
	// does this week's deliveries, the default.
	const applied = $derived.by(() => {
		const { text, delivery, from, to, status, hasIncident } = filters;
		return [
			text && `Búsqueda: ${text}`,
			'ALL' !== delivery && `Entrega: ${DELIVERY_PERIOD_LABELS[delivery].toLowerCase()}`,
			eventRange(from, to),
			status && `Estado: ${ORDER_STATUS_LABELS[status]}`,
			hasIncident && 'Solo con novedad'
		].filter((piece) => 'string' === typeof piece);
	});
	const isFiltered = $derived(0 < applied.length);
	const countLabel = $derived.by(() => {
		const count = `${data.total} ${1 === data.total ? 'pedido' : 'pedidos'}`;
		return 1 < data.pageCount ? `${count} · página ${filters.page} de ${data.pageCount}` : count;
	});
	// No order at all, as opposed to none matching.
	const isEmpty = $derived(!isFiltered && 0 === data.orders.length);

	let isSheetOpen = $state(false);
	let areFiltersShown = $state(false);

	function eventRange(from: string | undefined, to: string | undefined): string | undefined {
		if (from && to) {
			return `Evento ${from === to ? formatLongDay(from) : formatPeriod(from, to)}`;
		}
		if (from) {
			return `Evento desde ${formatCivilDate(from)}`;
		}
		return to && `Evento hasta ${formatCivilDate(to)}`;
	}

	// Another page of the same filters.
	function pageHref(pageNumber: number): string {
		const kept = [...page.url.searchParams].filter(([name]) => 'pagina' !== name);
		const turned = 1 === pageNumber ? [] : [['pagina', String(pageNumber)]];
		return `?${new URLSearchParams([...kept, ...turned])}`;
	}

	function submitOnChange(event: Event & { currentTarget: HTMLFormElement }) {
		event.currentTarget.requestSubmit();
	}
</script>

<svelte:head>
	<title>Pedidos · Banquetes Consuelo C</title>
</svelte:head>

{#snippet newOrder(inline: boolean)}
	<Button href={resolve('/pedidos/nuevo')} {inline}>Nuevo pedido</Button>
{/snippet}

{#snippet badges(order: OrderSummary)}
	<span class="badges">
		<Badge tone={ORDER_STATUS_TONES[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
		{#if order.hasIncident}
			<Badge tone="error">Con novedad</Badge>
		{/if}
	</span>
{/snippet}

{#snippet filterButton(label: string, expanded: boolean | undefined, onclick: () => void)}
	<Button type="button" variant="secondary" size="sm" inline aria-expanded={expanded} {onclick}>
		<Icon name="filter" size="sm" />
		{label}{isFiltered ? ` (${applied.length})` : ''}
	</Button>
{/snippet}

{#snippet fields(prefix: string)}
	<div class="filters">
		<Field label="Nombre o teléfono" id="{prefix}texto">
			<Input
				id="{prefix}texto"
				name="texto"
				type="search"
				placeholder="Ej. Restrepo o 310 442"
				value={filters.text ?? ''}
			/>
		</Field>
		<Field label="Entrega" id="{prefix}entrega">
			<Select id="{prefix}entrega" name="entrega" value={filters.delivery}>
				{#each Object.entries(DELIVERY_PERIOD_LABELS) as [period, label] (period)}
					<option value={period}>{label}</option>
				{/each}
			</Select>
		</Field>
		<div class="filters__range">
			<div class="field-row">
				<Field label="Evento desde" id="{prefix}desde">
					<Input id="{prefix}desde" name="desde" type="date" value={filters.from ?? ''} />
				</Field>
				<Field label="Hasta" id="{prefix}hasta">
					<Input id="{prefix}hasta" name="hasta" type="date" value={filters.to ?? ''} />
				</Field>
			</div>
			<p class="field__hint">La misma fecha en los dos es un día exacto.</p>
		</div>
		<!-- '' is «no filter». -->
		<Field label="Estado" id="{prefix}estado">
			<Select id="{prefix}estado" name="estado" value={filters.status ?? ''}>
				<option value="">Todos</option>
				{#each Object.entries(ORDER_STATUS_LABELS) as [status, label] (status)}
					<option value={status}>{label}</option>
				{/each}
			</Select>
		</Field>
		<!-- Not a status: an order completed with damage is still completed. -->
		<div class="filters__wide">
			<Chip
				name="novedad"
				value="1"
				label="Solo con novedad"
				checked={true === filters.hasIncident}
			/>
		</div>
	</div>
{/snippet}

<Screen wide>
	{#snippet header()}
		<ScreenHeader title="Pedidos" />
	{/snippet}

	{#if isEmpty}
		<div class="empty">
			<p>Aún no hay pedidos.</p>
			{@render newOrder(true)}
		</div>
	{:else}
		<div class="toolbar phone-only">
			{@render filterButton('Filtros', undefined, () => (isSheetOpen = true))}
			<span class="meta">{countLabel}</span>
		</div>
		{#if isFiltered}
			<p class="meta summary phone-only">{applied.join(' · ')}</p>
		{/if}

		<div class="desktop-only">
			<div class="toolbar">
				<p class="meta">{[countLabel, ...applied].join(' · ')}</p>
				{@render filterButton(
					areFiltersShown ? 'Ocultar filtros' : 'Filtros',
					areFiltersShown,
					() => (areFiltersShown = !areFiltersShown)
				)}
			</div>
			{#if areFiltersShown}
				<!-- No apply button: a changed field reloads the list from its first page. -->
				<form
					class="filters-form"
					method="GET"
					data-sveltekit-keepfocus
					data-sveltekit-noscroll
					onchange={submitOnChange}
				>
					{@render fields('desktop-')}
				</form>
			{/if}
		</div>

		{#if 0 === data.orders.length}
			<div class="none">
				<p>Ningún pedido coincide con estos filtros.</p>
				<Button variant="secondary" inline href="{resolve('/pedidos')}?entrega=ALL"
					>Ver todos</Button
				>
			</div>
		{:else}
			<div class="phone-only">
				{#each data.orders as order (order.id)}
					<Card href={resolve('/(app)/pedidos/[id]', { id: String(order.id) })}>
						{#snippet head()}
							<b>#{order.id}</b>
							{@render badges(order)}
						{/snippet}
						<p class="meta">{order.clientName} · {formatLongDay(order.eventDate)}</p>
						<p class="meta">{DELIVERY_METHOD_LABELS[order.deliveryMethod]}</p>
						<div class="card__amounts">
							<span class="card__amount">{formatPesos(order.orderTotal)}</span>
							{#if 0 !== order.balanceDue}
								<span class="meta">Saldo {formatPesos(order.balanceDue)}</span>
							{/if}
						</div>
					</Card>
				{/each}
			</div>

			<table class="table desktop-only">
				<thead>
					<tr>
						<th>#</th>
						<th>Cliente</th>
						<th>Evento</th>
						<th>Estado</th>
						<th>Método de entrega</th>
						<th class="num">Total</th>
						<th class="num">Saldo</th>
					</tr>
				</thead>
				<tbody>
					{#each data.orders as order (order.id)}
						<tr>
							<td
								><a class="row-link" href={resolve('/(app)/pedidos/[id]', { id: String(order.id) })}
									><b>{order.id}</b></a
								></td
							>
							<td>{order.clientName}</td>
							<td class="nowrap">{formatLongDay(order.eventDate)}</td>
							<td>{@render badges(order)}</td>
							<td>{DELIVERY_METHOD_LABELS[order.deliveryMethod]}</td>
							<td class="num nowrap"><b>{formatPesos(order.orderTotal)}</b></td>
							<td class="num nowrap balance">
								{0 === order.balanceDue ? '' : formatPesos(order.balanceDue)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="pages">
				<Pagination current={filters.page} count={data.pageCount} href={pageHref} />
			</div>
		{/if}

		<div class="screen__action">{@render newOrder(false)}</div>
	{/if}
</Screen>

<BottomSheet bind:open={isSheetOpen} title="Filtros">
	<form method="GET" data-sveltekit-noscroll onsubmit={() => (isSheetOpen = false)}>
		{@render fields('phone-')}
		<div class="sheet__actions">
			<Button variant="secondary" href={resolve('/pedidos')} onclick={() => (isSheetOpen = false)}>
				Limpiar
			</Button>
			<Button type="submit">Ver pedidos</Button>
		</div>
	</form>
</BottomSheet>

<style>
	p {
		margin: 0;
	}

	.desktop-only {
		display: none;
	}

	.toolbar {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}

	.summary {
		margin-bottom: var(--space-7);
	}

	.badges {
		display: flex;
		flex: none;
		gap: var(--space-3);
	}

	.card__amounts {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	.card__amount {
		font: var(--weight-bold) var(--text-lg) / 1.3 var(--font-sans);
		font-variant-numeric: tabular-nums;
	}

	.empty,
	.none {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		align-items: center;
		padding: var(--space-14) 0 var(--space-12);
		text-align: center;
	}

	.pages {
		margin-top: var(--space-8);
	}

	/* The filters: pairs side by side and the rest full width on a phone, a grid on a desktop. */
	.filters {
		display: flex;
		flex-direction: column;
		gap: var(--field-gap);
	}

	.field-row {
		display: flex;
		gap: var(--control-gap);
	}

	.field__hint {
		margin-top: var(--space-3);
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.sheet__actions {
		display: flex;
		gap: var(--control-gap);
		margin-top: var(--space-9);
	}

	.sheet__actions > :global(:first-child) {
		flex: 1;
	}

	.sheet__actions > :global(:last-child) {
		flex: 2;
	}

	.table {
		width: 100%;
		font-size: var(--text-md);
		border-collapse: collapse;
	}

	.table th {
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-label);
		font-weight: var(--weight-bold);
		line-height: 1.5;
		color: var(--text-secondary);
		text-align: left;
		border-bottom: var(--border-w-strong) solid var(--border-strong);
	}

	.table td {
		padding: var(--space-4);
		vertical-align: middle;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.balance {
		color: var(--text-secondary);
	}

	.nowrap {
		white-space: nowrap;
	}

	/* The order number is the row's link, and its hit area covers the whole row. */
	.table tbody tr {
		position: relative;
	}

	.row-link {
		color: inherit;
		text-decoration: none;
	}

	.row-link::after {
		position: absolute;
		inset: 0;
		content: '';
	}

	@container (width >= 1024px) {
		.phone-only {
			display: none;
		}

		.desktop-only {
			display: block;
		}

		.table.desktop-only {
			display: table;
		}

		.toolbar {
			margin-bottom: var(--space-7);
		}

		.filters-form {
			margin-bottom: var(--space-9);
		}

		.filters {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
			gap: var(--space-7);
			align-items: end;
		}

		/* The pairs become cells of the grid like every other field. */
		.field-row,
		.filters__range {
			display: contents;
		}

		.filters__range .field__hint {
			display: none;
		}

		.filters__wide {
			grid-column: 1 / -1;
		}
	}
</style>
