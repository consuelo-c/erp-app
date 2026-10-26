<script lang="ts">
	import { resolve } from '$app/paths';
	import OrderTimeline from '../../OrderTimeline.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<OrderTimeline
	orderId={data.orderId}
	entries={data.entries}
	backHref={resolve('/(app)/pedidos/[id]', { id: String(data.orderId) })}
/>
