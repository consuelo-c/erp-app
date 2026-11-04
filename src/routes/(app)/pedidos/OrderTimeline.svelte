<script lang="ts">
	import { resolve } from '$app/paths';
	import { ORDER_STATUS_LABELS } from '$lib/labels';
	import type { TimelineEntry } from '$lib/server/services/orders';
	import EventTimeline from '../EventTimeline.svelte';

	// The order's events. An edit's changes load from Pedidos: only the roles that open Pedidos see
	// edits. Despachos shows it too, going back to its own detail.
	let {
		orderId: id,
		entries,
		backHref
	}: { orderId: number; entries: TimelineEntry[]; backHref: string } = $props();

	const orderId = $derived(String(id));

	const ACTION_TITLES: Record<TimelineEntry['action'], string> = {
		CREATED: 'Creado',
		EDITED: 'Editado',
		STATUS_CHANGED: 'Cambio de estado',
		CANCELLED: 'Cancelado',
		RECEIVABLE_LINKED: 'Incluido en la cuenta de cobro',
		RECEIVABLE_UNLINKED: 'Retirado de la cuenta de cobro'
	};

	// A status change reads as the status it moved to: «Confirmado».
	function titleOf(entry: TimelineEntry): string {
		if ('STATUS_CHANGED' === entry.action && null !== entry.status) {
			return ORDER_STATUS_LABELS[entry.status];
		}
		if (null !== entry.receivableId) {
			return `${ACTION_TITLES[entry.action]} Nº ${entry.receivableId}`;
		}
		return ACTION_TITLES[entry.action];
	}

	function changesHref(eventId: number): string {
		return resolve('/(app)/pedidos/[id]/historial/[evento]', {
			id: orderId,
			evento: String(eventId)
		});
	}
</script>

{#snippet heading(entry: TimelineEntry)}{titleOf(entry)}{/snippet}

<EventTimeline
	title="Historial #{orderId}"
	pageTitle="Historial · Pedido #{orderId}"
	{backHref}
	{entries}
	empty="Este pedido no tiene historial."
	{heading}
	{changesHref}
/>
