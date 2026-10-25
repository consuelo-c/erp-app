<script lang="ts">
	// STUB: phase 09, issue #251 replaces this with the order's detail.
	import { resolve } from '$app/paths';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Pedido #{data.id} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Pedido #{data.id}" backHref={resolve('/pedidos')} />
	{/snippet}
</Screen>
