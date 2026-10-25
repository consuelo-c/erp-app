<script lang="ts">
	import { resolve } from '$app/paths';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import { formatInstant } from '$lib/datetime';
	import { ORDER_STATUS_LABELS } from '$lib/labels';
	import type { OrderChange } from '$lib/server/order-changes';
	import type { TimelineEntry } from '$lib/server/services/orders';
	import type { PageProps } from './$types';

	// Newest first. An edit's changes stay on the server until its row opens, then load once.
	let { data }: PageProps = $props();

	const orderId = $derived(String(data.orderId));

	const ACTION_TITLES: Record<TimelineEntry['action'], string> = {
		CREATED: 'Creado',
		EDITED: 'Editado',
		STATUS_CHANGED: 'Cambio de estado',
		CANCELLED: 'Cancelado'
	};

	// A status change reads as the status it moved to: «Confirmado».
	function titleOf(entry: TimelineEntry): string {
		if ('STATUS_CHANGED' === entry.action && null !== entry.status) {
			return ORDER_STATUS_LABELS[entry.status];
		}
		return ACTION_TITLES[entry.action];
	}

	let changes = $state<Record<number, OrderChange[] | 'loading' | 'error'>>({});

	// Opened again after a failure, it asks again.
	async function loadChanges(event: number) {
		if (undefined !== changes[event] && 'error' !== changes[event]) {
			return;
		}
		changes[event] = 'loading';
		const href = resolve('/(app)/pedidos/[id]/historial/[evento]', {
			id: orderId,
			evento: String(event)
		});
		try {
			const response = await fetch(href);
			changes[event] = response.ok ? await response.json() : 'error';
		} catch {
			changes[event] = 'error';
		}
	}

	function onToggle(event: Event & { currentTarget: HTMLDetailsElement }, id: number) {
		if (event.currentTarget.open) {
			loadChanges(id);
		}
	}
</script>

<svelte:head>
	<title>Historial · Pedido #{orderId} · Banquetes Consuelo C</title>
</svelte:head>

{#snippet heading(entry: TimelineEntry, opens: boolean)}
	<div class="timeline__title">{titleOf(entry)}{opens ? ' ⌄' : ''}</div>
	<div class="timeline__meta">{formatInstant(entry.createdAt)} · {entry.actorUsername}</div>
{/snippet}

{#snippet editChanges(loaded: OrderChange[] | 'loading' | 'error' | undefined)}
	{#if 'error' === loaded}
		<div class="entry__notice">
			<Notice tone="error">No se pudieron cargar los cambios. Ciérralo y ábrelo de nuevo.</Notice>
		</div>
	{:else if undefined === loaded || 'loading' === loaded}
		<p class="meta entry__loading">Cargando los cambios…</p>
	{:else if 0 === loaded.length}
		<p class="meta entry__loading">Sin cambios para mostrar.</p>
	{:else}
		<ul class="entry__box entry__changes">
			{#each loaded as change, index (index)}
				<li>
					<div class="entry__label">{change.label}</div>
					<div>{change.change}</div>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader
			title="Historial #{orderId}"
			backHref={resolve('/(app)/pedidos/[id]', { id: orderId })}
		/>
	{/snippet}

	{#if 0 === data.entries.length}
		<!-- The development seed's orders write no events. -->
		<p class="meta">Este pedido no tiene historial.</p>
	{:else}
		<Timeline>
			{#each data.entries as entry (entry.id)}
				<li>
					{#if 'EDITED' === entry.action}
						<details ontoggle={(event) => onToggle(event, entry.id)}>
							<summary class="entry__summary">{@render heading(entry, true)}</summary>
							{@render editChanges(changes[entry.id])}
						</details>
					{:else}
						{@render heading(entry, false)}
					{/if}
					{#if entry.reason}
						<p class="entry__box">
							<span class="entry__label entry__label--inline">Motivo:</span>
							{entry.reason}
						</p>
					{/if}
				</li>
			{/each}
		</Timeline>
	{/if}
</Screen>

<style>
	.entry__summary {
		cursor: pointer;
		list-style: none;
	}

	.entry__summary::-webkit-details-marker {
		display: none;
	}

	.entry__box {
		padding: var(--space-5) var(--space-6);
		margin: var(--space-4) 0 0;
		font-size: var(--text-md);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-input);
	}

	.entry__changes {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		list-style: none;
	}

	.entry__label {
		font-weight: var(--weight-semibold);
	}

	.entry__label--inline {
		color: var(--text-secondary);
	}

	.entry__loading {
		margin: var(--space-4) 0 0;
	}

	.entry__notice {
		margin-top: var(--space-4);
	}
</style>
