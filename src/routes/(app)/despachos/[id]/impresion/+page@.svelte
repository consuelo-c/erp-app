<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import OrderPrintout from '../../../pedidos/OrderPrintout.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Back to the detail, its query kept: it knows the tab the order was opened from.
	const backHref = $derived(
		`${resolve('/(app)/despachos/[id]', { id: String(data.printout.order.id) })}${page.url.search}`
	);
</script>

<OrderPrintout printout={data.printout} {backHref} />
