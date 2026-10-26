<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import OrderTimeline from '../../../pedidos/OrderTimeline.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Back to the detail, its query kept: it knows the tab the order was opened from.
	const backHref = $derived(
		`${resolve('/(app)/despachos/[id]', { id: String(data.orderId) })}${page.url.search}`
	);
</script>

<OrderTimeline orderId={data.orderId} entries={data.entries} {backHref} />
