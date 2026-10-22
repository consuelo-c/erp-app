<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { formatInteger, formatPesos } from '$lib/format';
	import { CATEGORY_LABELS } from '$lib/labels';
	import { catalogHref, INVENTORY_TABS } from '$lib/navigation';
	import type { Product } from '$lib/server/services/products';
	import { describeGroup, findVariants, groupCatalog, summarizeGroup } from './catalog';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const sections = $derived(groupCatalog(data.products));
	// `?grupo=` opens one group's variants; a group with none left falls back to the list.
	const group = $derived(page.url.searchParams.get('grupo'));
	const variants = $derived(null === group ? [] : findVariants(data.products, group));
</script>

<svelte:head>
	<title>{group ?? 'Productos'} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		{#if variants.length}
			<ScreenHeader title={group!} backHref={catalogHref(null)} />
		{:else}
			<ScreenHeader><Tabs tabs={INVENTORY_TABS} current="Productos" /></ScreenHeader>
		{/if}
	{/snippet}

	<!-- Set by the product form's redirect after a save. -->
	{#if page.url.searchParams.has('guardado')}
		<div class="saved"><Notice tone="success">Producto guardado con éxito</Notice></div>
	{/if}

	{#if variants.length}
		<p class="meta group-meta">{describeGroup(variants)}</p>
		<table class="table">
			<thead>
				<tr>
					<th>Variante</th><th class="num">Precio/día</th><th class="num">Inventario</th>
					{#if data.canEdit}<th><span class="visually-hidden">Abrir</span></th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each variants as variant (variant.id)}
					<tr
						class={[data.canEdit && 'table__row--link', !variant.isActive && 'table__row--muted']}
					>
						<td>
							<span class="variant">
								{#if data.canEdit}
									<a
										class="table__link"
										href={resolve('/(app)/inventario/productos/[id]', { id: String(variant.id) })}
										>{variant.variantName}</a
									>
								{:else}
									{variant.variantName}
								{/if}
								{#if !variant.isActive}<Badge>Inactivo</Badge>{/if}
							</span>
						</td>
						<td class="num">{formatPesos(variant.rentalPrice)}</td>
						<td class="num">{formatInteger(variant.totalQuantity)}</td>
						{#if data.canEdit}<td class="num chevron">›</td>{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	{:else if 0 === sections.length}
		<!-- Empty state: the action sits centered under the message. -->
		<div class="empty">
			<p><strong>Aún no hay productos</strong></p>
			{#if data.canEdit}
				<p class="meta">Crea el primero con Nuevo producto.</p>
				<div class="empty__action">{@render newProduct()}</div>
			{/if}
		</div>
	{:else}
		{#each sections as section (section.category)}
			<section class="category">
				<h2 class="section-title">{CATEGORY_LABELS[section.category]}</h2>
				<ul class="products">
					{#each section.rows as row ('group' === row.kind ? row.name : row.product.id)}
						<li>
							{#if 'group' === row.kind}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- catalogHref builds it with resolve() -->
								<a class="product" href={catalogHref(row.name)}>
									{@render description(row.name, summarizeGroup(row.variants), true)}
									<span class="chevron">›</span>
								</a>
							{:else if data.canEdit}
								<a
									class={['product', !row.product.isActive && 'product--inactive']}
									href={resolve('/(app)/inventario/productos/[id]', { id: String(row.product.id) })}
								>
									{@render productRow(row.product)}
									<span class="chevron">›</span>
								</a>
							{:else}
								<div class={['product', !row.product.isActive && 'product--inactive']}>
									{@render productRow(row.product)}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/each}

		{#if data.canEdit}
			<div class="screen__action">{@render newProduct()}</div>
		{/if}
	{/if}
</Screen>

{#snippet productRow(product: Product)}
	{@render description(product.name, `${formatPesos(product.rentalPrice)}/día`, product.isActive)}
	<span class="quantity">
		<span class="quantity__value">{formatInteger(product.totalQuantity)}</span>
		<span class="quantity__label">en inventario</span>
	</span>
{/snippet}

{#snippet description(name: string, meta: string, isActive: boolean)}
	<span class="product__text">
		<span class="product__name">
			{name}
			{#if !isActive}<Badge>Inactivo</Badge>{/if}
		</span>
		<span class="meta">{meta}</span>
	</span>
{/snippet}

{#snippet newProduct()}
	<Button href={resolve('/inventario/productos/nuevo')}>Nuevo producto</Button>
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

	.category {
		margin-bottom: var(--space-10);
	}

	.products {
		padding: 0;
		margin: 0;
		list-style: none;
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.product {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		min-height: 60px;
		padding: var(--space-4) 0;
		color: inherit;
		text-decoration: none;
		border-bottom: var(--border-w) solid var(--border-default);
	}

	/* Still in its category, faded, with its badge. */
	.product--inactive {
		opacity: 0.55;
	}

	.product__text {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.product__name {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		align-items: center;
		font: var(--weight-semibold) var(--text-base) / 1.3 var(--font-sans);
	}

	/* Right-aligned, so quantities compare down the list. */
	.quantity {
		display: flex;
		flex: none;
		flex-direction: column;
		text-align: right;
	}

	.quantity__value {
		font: var(--weight-semibold) var(--text-base) / 1.3 var(--font-sans);
		font-variant-numeric: tabular-nums;
	}

	.quantity__label {
		font-size: var(--text-label);
		color: var(--text-secondary);
	}

	.chevron {
		flex: none;
		font-size: var(--text-xl);
		color: var(--text-disabled);
	}

	.group-meta {
		margin-bottom: var(--space-8);
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
		color: var(--text-secondary);
		text-align: left;
		border-bottom: var(--border-w-strong) solid var(--border-strong);
	}

	/* 48px rows: twenty colors scroll by with the thumb. */
	.table td {
		height: 48px;
		padding: 0 var(--space-4);
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}

	.variant {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		align-items: center;
	}

	/* The variant's link covers its whole row: one tap target per variant. */
	.table__row--link {
		position: relative;
	}

	.table__row--muted td {
		color: var(--text-secondary);
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
