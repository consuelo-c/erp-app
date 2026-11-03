<script
	lang="ts"
	generics="Entry extends { id: number; action: string; createdAt: number; actorUsername: string; reason?: string | null }"
>
	import type { Snippet } from 'svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import { formatInstant } from '$lib/datetime';
	import type { OrderChange } from '$lib/server/order-changes';

	// A record's events, newest first: an order's or a quote's. An edit's changes stay on the server
	// until its row opens, then load once from `changesHref`; the caller names each event.
	interface Props {
		title: string;
		pageTitle: string;
		backHref: string;
		entries: Entry[];
		/** What a record with no events says: the development seed writes none. */
		empty: string;
		/** The event's title: an action, a status, a link. */
		heading: Snippet<[Entry]>;
		changesHref: (eventId: number) => string;
	}

	let { title, pageTitle, backHref, entries, empty, heading, changesHref }: Props = $props();

	let changes = $state<Record<number, OrderChange[] | 'loading' | 'error'>>({});

	// Opened again after a failure, it asks again.
	async function loadChanges(eventId: number) {
		if (undefined !== changes[eventId] && 'error' !== changes[eventId]) {
			return;
		}
		changes[eventId] = 'loading';
		try {
			const response = await fetch(changesHref(eventId));
			changes[eventId] = response.ok ? await response.json() : 'error';
		} catch {
			changes[eventId] = 'error';
		}
	}

	function onToggle(event: Event & { currentTarget: HTMLDetailsElement }, eventId: number) {
		if (event.currentTarget.open) {
			loadChanges(eventId);
		}
	}
</script>

<svelte:head>
	<title>{pageTitle} · Banquetes Consuelo C</title>
</svelte:head>

{#snippet entryHeading(entry: Entry, opens: boolean)}
	<div class="timeline__title">{@render heading(entry)}{opens ? ' ⌄' : ''}</div>
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
		<ScreenHeader {title} {backHref} />
	{/snippet}

	{#if 0 === entries.length}
		<p class="meta">{empty}</p>
	{:else}
		<Timeline>
			{#each entries as entry (entry.id)}
				<li>
					{#if 'EDITED' === entry.action}
						<details ontoggle={(event) => onToggle(event, entry.id)}>
							<summary class="entry__summary">{@render entryHeading(entry, true)}</summary>
							{@render editChanges(changes[entry.id])}
						</details>
					{:else}
						{@render entryHeading(entry, false)}
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
