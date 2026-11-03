<script lang="ts">
	import { resolve } from '$app/paths';
	import type { QuoteTimelineEntry } from '$lib/server/services/quotes';
	import EventTimeline from '../../../EventTimeline.svelte';
	import type { PageProps } from './$types';

	// Every event for every role that reaches it: only the ones who take quotes do.
	let { data }: PageProps = $props();

	const quoteId = $derived(String(data.quoteId));

	const ACTION_TITLES: Record<QuoteTimelineEntry['action'], string> = {
		CREATED: 'Creada',
		EDITED: 'Editada',
		CONVERTED: 'Convertida en el pedido'
	};

	function changesHref(eventId: number): string {
		return resolve('/(app)/cotizaciones/[id]/historial/[evento]', {
			id: quoteId,
			evento: String(eventId)
		});
	}
</script>

{#snippet heading(entry: QuoteTimelineEntry)}
	{ACTION_TITLES[entry.action]}
	{#if null !== entry.orderId}
		<a href={resolve('/(app)/pedidos/[id]', { id: String(entry.orderId) })}>#{entry.orderId}</a>
	{/if}
{/snippet}

<EventTimeline
	title="Historial cotización #{quoteId}"
	pageTitle="Historial · Cotización #{quoteId}"
	backHref={resolve('/(app)/cotizaciones/[id]', { id: quoteId })}
	entries={data.entries}
	empty="Esta cotización no tiene historial."
	{heading}
	{changesHref}
/>
