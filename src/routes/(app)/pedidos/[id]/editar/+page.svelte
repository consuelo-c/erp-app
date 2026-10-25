<script lang="ts">
	import { resolve } from '$app/paths';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import OrderForm from '../../OrderForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Editar pedido #{data.order.id} · Banquetes Consuelo C</title>
</svelte:head>

<Screen wide>
	{#snippet header()}
		<ScreenHeader
			title="Editar pedido #{data.order.id}"
			backHref={resolve('/(app)/pedidos/[id]', { id: String(data.order.id) })}
		/>
	{/snippet}
	<OrderForm options={data.options} order={data.order} {form} />
</Screen>
