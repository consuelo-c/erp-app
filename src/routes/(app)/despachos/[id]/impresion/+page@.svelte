<script lang="ts">
	import { resolve } from '$app/paths';
	import OrderPrintout from '../../../pedidos/OrderPrintout.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<OrderPrintout
	printout={data.printout}
	backHref={resolve('/(app)/despachos/[id]', { id: String(data.printout.order.id) })}
/>
