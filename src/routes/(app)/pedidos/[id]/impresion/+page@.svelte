<script lang="ts">
	import { resolve } from '$app/paths';
	import OrderPrintout from '../../OrderPrintout.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<OrderPrintout
	printout={data.printout}
	backHref={resolve('/(app)/pedidos/[id]', { id: String(data.printout.order.id) })}
/>
