<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Select from '$lib/components/Select.svelte';
	import { formatCivilDate, getInstantDate } from '$lib/datetime';
	import { formatInteger, formatPesos } from '$lib/format';
	import { CATEGORY_ICONS, CATEGORY_LABELS } from '$lib/labels';
	import { catalogName, sortCatalog } from './catalog';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const products = $derived(sortCatalog(data.products));

	const filters = $derived(data.filters);
	const isFiltered = $derived('' !== filters.search || undefined !== filters.category);
	// No product at all, as opposed to none matching: the filters have nothing to narrow.
	const isEmpty = $derived(!isFiltered && 0 === products.length);

	const noneText = $derived.by(() => {
		const { search, category } = filters;
		const among = category ? ` en ${CATEGORY_LABELS[category]}` : '';
		return '' === search
			? `Aún no hay productos${among}.`
			: `Nada coincide con «${search}»${among}.`;
	});

	let typing: ReturnType<typeof setTimeout> | undefined;

	// The list narrows as it's typed, once the typing pauses; a category applies when picked.
	function searchSoon(event: Event & { currentTarget: HTMLInputElement }) {
		const { form } = event.currentTarget;
		clearTimeout(typing);
		typing = setTimeout(() => form?.requestSubmit(), 300);
	}

	function apply(event: Event & { currentTarget: HTMLSelectElement }) {
		event.currentTarget.form?.requestSubmit();
	}
</script>

<svelte:head>
	<title>Productos · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Productos" />
	{/snippet}

	<!-- Set by the product form's redirect after a save. -->
	{#if page.url.searchParams.has('guardado')}
		<div class="saved"><Notice tone="success">Producto guardado con éxito</Notice></div>
	{/if}

	{#if isEmpty}
		<!-- Empty state: the action sits centered under the message. -->
		<div class="empty">
			<p><strong>Aún no hay productos</strong></p>
			{#if data.canEdit}
				<p class="meta">Crea el primero con Nuevo producto.</p>
				<div class="empty__action">{@render newProduct()}</div>
			{/if}
		</div>
	{:else}
		<!-- Each filter is in the URL, so a reload or the browser's back keeps it. -->
		<form
			class="tools"
			method="GET"
			data-sveltekit-keepfocus
			data-sveltekit-noscroll
			data-sveltekit-replacestate
		>
			<label class="search">
				<Icon name="search" size="sm" />
				<Input
					type="search"
					name="texto"
					aria-label="Buscar por nombre o variante"
					placeholder="Nombre o variante"
					value={filters.search}
					oninput={searchSoon}
				/>
			</label>
			<Select
				name="categoria"
				aria-label="Categoría"
				value={filters.category ?? ''}
				onchange={apply}
			>
				<option value="">Todas las categorías</option>
				{#each Object.entries(CATEGORY_LABELS) as [category, label] (category)}
					<option value={category}>{label}</option>
				{/each}
			</Select>
		</form>

		{#if 0 === products.length}
			<div class="none">
				<p class="meta">{noneText}</p>
				<Button href="{resolve('/productos')}?limpiar" variant="secondary" inline>Ver todos</Button>
			</div>
		{:else}
			<!-- On a phone names never wrap: the table scrolls sideways instead. -->
			<div class="scroll">
				<table class="table">
					<thead>
						<tr>
							<th class="table__icon"><span class="visually-hidden">Categoría</span></th>
							<th>Producto</th>
							<th class="num">Precio/día</th>
							<th class="num">Inventario</th>
							{#if data.canEdit}<th><span class="visually-hidden">Abrir</span></th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each products as product (product.id)}
							{@const category = CATEGORY_LABELS[product.category]}
							{@const updated = `Inventario actualizado el ${formatCivilDate(getInstantDate(product.quantityUpdatedAt))}`}
							<tr
								class={[
									data.canEdit && 'table__row--link',
									!product.isActive && 'table__row--inactive'
								]}
							>
								<td class="table__icon">
									<span class="hint" title={category}>
										<Icon name={CATEGORY_ICONS[product.category]} />
										<span class="visually-hidden">{category}</span>
									</span>
								</td>
								<td>
									<span class="name">
										{#if data.canEdit}
											<a
												class="table__link"
												href={resolve('/(app)/productos/[id]', { id: String(product.id) })}
												>{catalogName(product)}</a
											>
										{:else}
											{catalogName(product)}
										{/if}
										<!-- Hover only: on a phone a tap doesn't open it. -->
										<span class="hint hint--info" title={updated}>
											<Icon name="info" size="sm" />
											<span class="visually-hidden">{updated}</span>
										</span>
										{#if !product.isActive}<Badge>Inactivo</Badge>{/if}
									</span>
								</td>
								<td class="num">{formatPesos(product.rentalPrice)}</td>
								<td class="num">{formatInteger(product.totalQuantity)}</td>
								{#if data.canEdit}<td class="num chevron">›</td>{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<!-- What the filters left, inactive ones included. -->
			<p class="meta count">
				{formatInteger(products.length)}
				{1 === products.length ? 'producto' : 'productos'}
			</p>
		{/if}

		{#if data.canEdit}
			<div class="screen__action">{@render newProduct()}</div>
		{/if}
	{/if}
</Screen>

{#snippet newProduct()}
	<Button href={resolve('/productos/nuevo')}>Nuevo producto</Button>
{/snippet}

<style>
	p {
		margin: 0;
	}

	.saved {
		margin-bottom: var(--space-5);
	}

	.empty {
		display: grid;
		place-content: center;
		height: 100%;
		text-align: center;
	}

	.empty__action {
		margin-top: var(--space-8);
	}

	.search {
		position: relative;
		display: block;
	}

	.search :global(.icon) {
		position: absolute;
		top: 50%;
		left: var(--input-icon-inset);
		color: var(--text-disabled);
		pointer-events: none;
		translate: 0 -50%;
	}

	.search :global(.input) {
		padding-left: var(--input-icon-pad);
	}

	/* Stacked on a phone; side by side, the text wider, from 1024px. */
	.tools {
		display: grid;
		gap: var(--space-4);
		margin-bottom: var(--space-10);
	}

	@container (width >= 1024px) {
		.tools {
			grid-template-columns: 3fr 2fr;
		}
	}

	.none {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		align-items: center;
		padding-top: var(--space-14);
		text-align: center;
	}

	.scroll {
		overflow-x: auto;
	}

	.count {
		margin: var(--space-4) 0 var(--space-10);
		text-align: right;
	}

	.table {
		width: 100%;
		font-size: var(--text-md);
		white-space: nowrap;
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
		height: 48px;
		padding: 0 var(--space-4);
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.table .table__icon {
		width: 20px;
		padding-right: 0;
	}

	.name {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		font-weight: var(--weight-semibold);
	}

	/* Above the row's link, so hovering it shows its title. */
	.hint {
		position: relative;
		z-index: 1;
		display: inline-flex;
	}

	.hint--info {
		color: var(--text-secondary);
		cursor: help;
	}

	.chevron {
		font-size: var(--text-xl);
		color: var(--text-disabled);
	}

	/* The product's link covers its whole row: one tap target per product. */
	.table__row--link {
		position: relative;
	}

	/* Still in its category, faded, with its badge. */
	.table__row--inactive {
		opacity: 0.55;
	}

	.table__link {
		color: inherit;
		text-decoration: none;
	}

	.table__link::after {
		position: absolute;
		inset: 0;
		content: '';
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		white-space: nowrap;
		clip-path: inset(50%);
	}
</style>
