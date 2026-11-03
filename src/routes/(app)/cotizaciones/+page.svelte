<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge, { QUOTE_STATE_TONES } from '$lib/components/Badge.svelte';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Input from '$lib/components/Input.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import Select from '$lib/components/Select.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatLongDay } from '$lib/datetime';
	import { formatPesos } from '$lib/format';
	import { QUOTE_STATE_FILTER_LABELS, QUOTE_STATE_LABELS } from '$lib/labels';
	import type { QuoteSummary } from '$lib/server/services/quotes';
	import type { PageProps } from './$types';

	// Every quote, newest first. Cards on a phone, a table from 1024px; the filters in a sheet on a
	// phone and under a toggle on a desktop, as in Pedidos, both a GET form, so a filtered list is a URL.
	let { data }: PageProps = $props();

	const filters = $derived(data.filters);

	// What narrows the list, as the screen reads it: the valid ones, the default, count as a filter.
	const applied = $derived(
		[
			filters.text && `Búsqueda: ${filters.text}`,
			'ALL' !== filters.state && `Estado: ${QUOTE_STATE_FILTER_LABELS[filters.state].toLowerCase()}`
		].filter((piece) => 'string' === typeof piece)
	);
	const isFiltered = $derived(0 < applied.length);
	const countLabel = $derived.by(() => {
		const count = `${data.total} ${1 === data.total ? 'cotización' : 'cotizaciones'}`;
		return 1 < data.pageCount ? `${count} · página ${filters.page} de ${data.pageCount}` : count;
	});

	let isSheetOpen = $state(false);
	let areFiltersShown = $state(false);

	function quoteHref(quote: QuoteSummary): string {
		return resolve('/(app)/cotizaciones/[id]', { id: String(quote.id) });
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
	<title>Cotizaciones · Banquetes Consuelo C</title>
</svelte:head>

{#snippet newQuote(inline: boolean)}
	<Button href={resolve('/cotizaciones/nueva')} {inline}>Nueva cotización</Button>
{/snippet}

{#snippet badge(quote: QuoteSummary)}
	<Badge tone={QUOTE_STATE_TONES[quote.state]}>{QUOTE_STATE_LABELS[quote.state]}</Badge>
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
				placeholder="Ej. Postobón o 576 5100"
				value={filters.text ?? ''}
			/>
		</Field>
		<Field label="Estado" id="{prefix}estado">
			<Select id="{prefix}estado" name="estado" value={filters.state}>
				{#each Object.entries(QUOTE_STATE_FILTER_LABELS) as [state, label] (state)}
					<option value={state}>{label}</option>
				{/each}
			</Select>
		</Field>
	</div>
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader title="Cotizaciones" />
	{/snippet}

	{#if !data.hasQuotes}
		<div class="empty">
			<p>Aún no hay cotizaciones.</p>
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

		{#if 0 === data.quotes.length}
			<div class="none">
				<p>Ninguna cotización coincide con estos filtros.</p>
				<Button variant="secondary" inline href="{resolve('/cotizaciones')}?estado=ALL"
					>Ver todas</Button
				>
			</div>
		{:else}
			<div class="phone-only">
				{#each data.quotes as quote (quote.id)}
					<Card href={quoteHref(quote)}>
						{#snippet head()}
							<b>#{quote.id}</b>
							{@render badge(quote)}
						{/snippet}
						<p class="meta">
							{quote.clientName} · {null === quote.eventDate
								? 'Sin fecha'
								: formatLongDay(quote.eventDate)}
						</p>
						<p class="meta">Válida hasta {formatLongDay(quote.validUntil)}</p>
						<div class="card__amounts">
							<span class="card__amount">{formatPesos(quote.quoteTotal)}</span>
							{#if quote.isTransportPending}
								<span class="meta">Sin transporte</span>
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
						<th>Válida hasta</th>
						<th>Estado</th>
						<th class="num">Total</th>
						<th class="edit" aria-label="Editar"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.quotes as quote (quote.id)}
						<tr>
							<td class="num"
								><a
									class="row-link"
									href={resolve('/(app)/cotizaciones/[id]', { id: String(quote.id) })}
									><b>{quote.id}</b></a
								></td
							>
							<td>{quote.clientName}</td>
							{#if null === quote.eventDate}
								<td class="nowrap secondary">Sin fecha</td>
							{:else}
								<td class="nowrap">{formatLongDay(quote.eventDate)}</td>
							{/if}
							<td class="nowrap">{formatLongDay(quote.validUntil)}</td>
							<td>{@render badge(quote)}</td>
							<td class="num nowrap">
								<b>{formatPesos(quote.quoteTotal)}</b>
								{#if quote.isTransportPending}
									<div class="meta">Sin transporte</div>
								{/if}
							</td>
							<td class="num edit">
								<!-- Above the row's link: editing is its own way in, while the quote is open. -->
								{#if 'CONVERTED' !== quote.state}
									<IconButton
										icon="edit"
										label="Editar cotización #{quote.id}"
										title="Editar cotización #{quote.id}"
										href={resolve('/(app)/cotizaciones/[id]/editar', { id: String(quote.id) })}
									/>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="pages">
				<Pagination current={filters.page} count={data.pageCount} href={pageHref} />
			</div>
		{/if}
	{/if}

	<div class="screen__action">{@render newQuote(false)}</div>
</Screen>

<BottomSheet bind:open={isSheetOpen} title="Filtros">
	<form method="GET" data-sveltekit-noscroll onsubmit={() => (isSheetOpen = false)}>
		{@render fields('phone-')}
		<div class="sheet__actions">
			<Button
				variant="secondary"
				href="{resolve('/cotizaciones')}?limpiar"
				onclick={() => (isSheetOpen = false)}
			>
				Limpiar
			</Button>
			<Button type="submit">Ver cotizaciones</Button>
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

	.filters {
		display: flex;
		flex-direction: column;
		gap: var(--field-gap);
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

	.table .edit {
		width: 44px;
		padding-block: 0;
	}

	.secondary {
		color: var(--text-secondary);
	}

	.nowrap {
		white-space: nowrap;
	}

	/* The quote number is the row's link, and its hit area covers the whole row. */
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

	/* The edit button sits over the row's link, so it gets its own click. */
	.edit :global(.icon-btn) {
		position: relative;
		z-index: 1;
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
			grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
			gap: var(--space-7);
			align-items: end;
		}
	}
</style>
