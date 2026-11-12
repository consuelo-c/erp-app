<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Input from '$lib/components/Input.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatLongDay } from '$lib/datetime';
	import { formatPesos } from '$lib/format';
	import type { PageProps } from './$types';

	// Every cuenta de cobro, newest first. Cards on a phone, a table from 1024px; the filters in a
	// sheet on a phone and under a toggle on a desktop, as in Pedidos, both a GET form, so a filtered
	// list is a URL. No primary action: a cuenta is issued from an order.
	let { data }: PageProps = $props();

	const filters = $derived(data.filters);

	// What narrows the list, as the screen reads it.
	const applied = $derived(
		[
			filters.text && `Búsqueda: ${filters.text}`,
			filters.hasBalance && 'Con saldo pendiente'
		].filter((piece) => 'string' === typeof piece)
	);
	const isFiltered = $derived(0 < applied.length);
	const countLabel = $derived.by(() => {
		const count = `${data.total} ${1 === data.total ? 'cuenta de cobro' : 'cuentas de cobro'}`;
		return 1 < data.pageCount ? `${count} · página ${filters.page} de ${data.pageCount}` : count;
	});
	// No cuenta at all, as opposed to none matching.
	const isEmpty = $derived(!isFiltered && 0 === data.receivables.length);

	let isSheetOpen = $state(false);
	let areFiltersShown = $state(false);

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
	<title>Cuentas de cobro · Banquetes Consuelo C</title>
</svelte:head>

{#snippet filterButton(label: string, expanded: boolean | undefined, onclick: () => void)}
	<Button type="button" variant="secondary" size="sm" inline aria-expanded={expanded} {onclick}>
		<Icon name="filter" size="sm" />
		{label}{isFiltered ? ` (${applied.length})` : ''}
	</Button>
{/snippet}

{#snippet fields(prefix: string)}
	<div class="filters">
		<Field label="Nombre, teléfono o usuario (WA)" id="{prefix}texto">
			<Input
				id="{prefix}texto"
				name="texto"
				type="search"
				placeholder="Ej. Postobón o 604 576"
				value={filters.text ?? ''}
			/>
		</Field>
		<div class="filters__chip">
			<Chip
				name="pendiente"
				value="1"
				label="Con saldo pendiente"
				checked={true === filters.hasBalance}
			/>
		</div>
	</div>
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader title="Cuentas de cobro" />
	{/snippet}

	{#if isEmpty}
		<div class="empty">
			<p>Aún no hay cuentas de cobro.</p>
			<p class="meta">Se emiten desde el detalle de un pedido.</p>
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

		{#if 0 === data.receivables.length}
			<div class="none">
				<p>Ninguna cuenta de cobro coincide con estos filtros.</p>
				<Button variant="secondary" inline href="{resolve('/cuentas-de-cobro')}?limpiar"
					>Ver todas</Button
				>
			</div>
		{:else}
			<div class="phone-only">
				{#each data.receivables as receivable (receivable.id)}
					<Card href={resolve('/(app)/cuentas-de-cobro/[id]', { id: String(receivable.id) })}>
						{#snippet head()}
							<b>Nº {receivable.id}</b>
						{/snippet}
						<p class="meta">{receivable.clientName} · {formatLongDay(receivable.issueDate)}</p>
						<div class="card__amounts">
							<span class="card__amount">{formatPesos(receivable.total)}</span>
							{#if receivable.isVoid}
								<span class="meta">Anulada</span>
							{:else if receivable.balance < 0}
								<span class="meta credit">Saldo a favor {formatPesos(-receivable.balance)}</span>
							{:else if 0 === receivable.balance}
								<span class="meta">Pagado</span>
							{:else}
								<span class="meta">Saldo {formatPesos(receivable.balance)}</span>
							{/if}
						</div>
					</Card>
				{/each}
			</div>

			<table class="table desktop-only">
				<thead>
					<tr>
						<th class="num">Nº</th>
						<th>Cliente</th>
						<th>Fecha de emisión</th>
						<th class="num">Total</th>
						<th class="num">Saldo</th>
						<th class="edit" aria-label="Editar"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.receivables as receivable (receivable.id)}
						<tr>
							<td class="num"
								><a
									class="row-link"
									href={resolve('/(app)/cuentas-de-cobro/[id]', { id: String(receivable.id) })}
									><b>{receivable.id}</b></a
								></td
							>
							<td>{receivable.clientName}</td>
							<td class="nowrap">{formatLongDay(receivable.issueDate)}</td>
							<td class="num nowrap"><b>{formatPesos(receivable.total)}</b></td>
							{#if receivable.isVoid}
								<td class="num nowrap secondary">Anulada</td>
							{:else if receivable.balance < 0}
								<td class="num nowrap credit">A favor {formatPesos(-receivable.balance)}</td>
							{:else if 0 === receivable.balance}
								<td class="num nowrap secondary">Pagado</td>
							{:else}
								<td class="num nowrap"><b>{formatPesos(receivable.balance)}</b></td>
							{/if}
							<td class="num edit">
								<IconButton
									icon="edit"
									label="Editar cuenta de cobro Nº {receivable.id}"
									title="Editar cuenta de cobro Nº {receivable.id}"
									href={resolve('/(app)/cuentas-de-cobro/[id]/editar', {
										id: String(receivable.id)
									})}
								/>
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
</Screen>

<BottomSheet bind:open={isSheetOpen} title="Filtros">
	<form method="GET" data-sveltekit-noscroll onsubmit={() => (isSheetOpen = false)}>
		{@render fields('phone-')}
		<div class="sheet__actions">
			<Button
				variant="secondary"
				href="{resolve('/cuentas-de-cobro')}?limpiar"
				onclick={() => (isSheetOpen = false)}
			>
				Limpiar
			</Button>
			<Button type="submit">Ver cuentas de cobro</Button>
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

	.empty {
		gap: var(--space-3);
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

	.credit {
		color: var(--success-fg);
	}

	.nowrap {
		white-space: nowrap;
	}

	/* The cuenta's number is the row's link, and its hit area covers the whole row. */
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
			grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
			gap: var(--space-7);
			align-items: end;
		}

		.filters__chip {
			padding-bottom: var(--space-2);
		}
	}
</style>
