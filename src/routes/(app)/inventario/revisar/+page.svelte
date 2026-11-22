<script lang="ts">
	import { resolve } from '$app/paths';
	import Badge, { INVENTORY_COUNT_STATUS_TONES } from '$lib/components/Badge.svelte';
	import Card from '$lib/components/Card.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatInstant } from '$lib/datetime';
	import { INVENTORY_COUNT_STATUS_LABELS } from '$lib/labels';
	import type { CountSummary } from '$lib/server/services/inventory';
	import type { PageProps } from './$types';

	// Several counts can wait at once, so the review is a list; a count's detail is its own page.
	let { data }: PageProps = $props();

	const pending = $derived(data.counts.filter(({ status }) => 'PENDING_APPROVAL' === status));
	const reviewed = $derived(data.counts.filter(({ status }) => 'PENDING_APPROVAL' !== status));

	const listFormat = new Intl.ListFormat('es');

	function plural(quantity: number, singular: string, pluralForm: string): string {
		return `${quantity} ${1 === quantity ? singular : pluralForm}`;
	}
</script>

<svelte:head>
	<title>Confirmar conteo · Banquetes Consuelo C</title>
</svelte:head>

{#snippet card(count: CountSummary)}
	<Card href={resolve('/(app)/inventario/revisar/[id]', { id: String(count.id) })}>
		{#snippet head()}
			<b>Conteo #{count.id}</b>
			<Badge tone={INVENTORY_COUNT_STATUS_TONES[count.status]}>
				{INVENTORY_COUNT_STATUS_LABELS[count.status]}
			</Badge>
		{/snippet}
		<p class="meta">{count.createdBy} · {formatInstant(count.createdAt)}</p>
		<p class="products">{plural(count.productCount, 'producto', 'productos')}</p>
		{#if count.staleCount}
			<p class="warning">
				{plural(count.staleCount, 'desactualizado', 'desactualizados')}
			</p>
		{/if}
		{#if count.overlapIds.length}
			<p class="warning">
				⚠ Comparte productos con {1 === count.overlapIds.length ? 'el conteo' : 'los conteos'}
				{listFormat.format(count.overlapIds.map((id) => `#${id}`))}
			</p>
		{/if}
	</Card>
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader title="Confirmar conteo" />
	{/snippet}

	{#if 0 === data.counts.length}
		<p class="empty">Todavía no hay conteos.</p>
	{:else}
		<h2 class="section-title">
			Pendientes{pending.length ? ` (${pending.length})` : ''}
		</h2>
		{#if 0 === pending.length}
			<p class="meta">No hay conteos pendientes.</p>
		{/if}
		{#each pending as count (count.id)}
			{@render card(count)}
		{/each}
		{#if reviewed.length}
			<h2 class="section-title reviewed">Revisados</h2>
			{#each reviewed as count (count.id)}
				{@render card(count)}
			{/each}
		{/if}
	{/if}
</Screen>

<style>
	p {
		margin: 0;
	}

	.products {
		margin-top: var(--space-3);
		font-size: var(--text-md);
	}

	.warning {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		color: var(--warning-fg);
	}

	.reviewed {
		margin-top: var(--space-9);
	}

	.empty {
		margin-top: var(--space-12);
		text-align: center;
	}
</style>
