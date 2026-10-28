<script lang="ts">
	import { resolve } from '$app/paths';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import OrderForm from '../OrderForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Nuevo pedido · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Nuevo pedido" backHref={resolve('/pedidos')} />
	{/snippet}
	<OrderForm options={data.options} order={null} {form} />
</Screen>
