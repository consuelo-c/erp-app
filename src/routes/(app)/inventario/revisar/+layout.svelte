<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge, { INVENTORY_COUNT_STATUS_TONES } from '$lib/components/Badge.svelte';
	import Card from '$lib/components/Card.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { formatInstant } from '$lib/datetime';
	import { INVENTORY_COUNT_STATUS_LABELS } from '$lib/labels';
	import { INVENTORY_TABS } from '$lib/navigation';
	import type { CountSummary } from '$lib/server/services/inventory';
	import type { LayoutProps } from './$types';

	// Several counts can wait at once, so the review is a list. A count's detail is its own route:
	// instead of the tabs and the list on a phone, a side panel beside them from 1024px.
	let { data, children }: LayoutProps = $props();

	const pending = $derived(data.counts.filter(({ status }) => 'PENDING_APPROVAL' === status));
	const reviewed = $derived(data.counts.filter(({ status }) => 'PENDING_APPROVAL' !== status));
	const openId = $derived(page.params.id);

	const listFormat = new Intl.ListFormat('es');

	function plural(quantity: number, singular: string, pluralForm: string): string {
		return `${quantity} ${1 === quantity ? singular : pluralForm}`;
	}
</script>

{#snippet card(count: CountSummary)}
	<div class={{ 'review__card--open': String(count.id) === openId }}>
		<Card href={resolve('/(app)/inventario/revisar/[id]', { id: String(count.id) })}>
			{#snippet head()}
				<b>Conteo #{count.id}</b>
				<Badge tone={INVENTORY_COUNT_STATUS_TONES[count.status]}>
					{INVENTORY_COUNT_STATUS_LABELS[count.status]}
				</Badge>
			{/snippet}
			<p class="meta">{count.createdBy} · {formatInstant(count.createdAt)}</p>
			<p class="review__products">{plural(count.productCount, 'producto', 'productos')}</p>
			{#if count.staleCount}
				<p class="review__warning">
					{plural(count.staleCount, 'desactualizado', 'desactualizados')}
				</p>
			{/if}
			{#if count.overlapIds.length}
				<p class="review__warning">
					⚠ Comparte productos con {1 === count.overlapIds.length ? 'el conteo' : 'los conteos'}
					{listFormat.format(count.overlapIds.map((id) => `#${id}`))}
				</p>
			{/if}
		</Card>
	</div>
{/snippet}

<div class={['review', { 'review--open': openId }]}>
	<div class="review__header">
		<ScreenHeader>
			<Tabs tabs={INVENTORY_TABS} current="Revisar conteo" />
		</ScreenHeader>
	</div>

	<div class="review__body">
		<div class="review__list">
			<Screen>
				{#if 0 === data.counts.length}
					<p class="review__empty">Todavía no hay conteos.</p>
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
						<h2 class="section-title review__reviewed">Revisados</h2>
						{#each reviewed as count (count.id)}
							{@render card(count)}
						{/each}
					{/if}
				{/if}
			</Screen>
		</div>

		<div class="review__detail">{@render children()}</div>
	</div>
</div>

<style>
	p {
		margin: 0;
	}

	.review {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.review__body {
		flex: 1;
		min-height: 0;
	}

	.review__list,
	.review__detail {
		height: 100%;
	}

	/* Ahead of the rules that hide it, which are more specific. */
	@container (width >= 1024px) {
		.review__detail {
			border-left: var(--border-w-hair) solid var(--border-default);
		}
	}

	/* A phone shows the list or a count, never both. */
	.review--open .review__header,
	.review--open .review__list,
	.review:not(.review--open) .review__detail {
		display: none;
	}

	.review__products {
		margin-top: var(--space-3);
		font-size: var(--text-md);
	}

	.review__warning {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		color: var(--warning-fg);
	}

	.review__reviewed {
		margin-top: var(--space-9);
	}

	.review__empty {
		margin-top: var(--space-12);
		text-align: center;
	}

	@container (width >= 1024px) {
		.review--open .review__header,
		.review--open .review__list,
		.review:not(.review--open) .review__detail {
			display: block;
		}

		/* List and panel share the screens' column, under the tabs. */
		.review__body {
			display: grid;
			grid-template-columns: minmax(0, 1fr) max(440px, 40%);
			width: 100%;
			max-width: var(--content-max-w);
			margin-inline: auto;
		}

		/* Ink marks the count whose detail is open. */
		.review__card--open :global(.card) {
			border-color: var(--border-strong);
		}
	}
</style>
