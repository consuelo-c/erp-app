<script lang="ts">
	import { resolve } from '$app/paths';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import OrderForm from '../../OrderForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Extensión del pedido #{data.original.id} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader
			title="Extensión del pedido #{data.original.id}"
			backHref={resolve('/(app)/pedidos/[id]', { id: String(data.original.id) })}
		/>
	{/snippet}
	<OrderForm options={data.options} order={null} original={data.original} {form} />
</Screen>
