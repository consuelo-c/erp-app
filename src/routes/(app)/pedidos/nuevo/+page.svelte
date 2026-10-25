<script lang="ts">
	// STUB: phase 09, issue #252 replaces this with the order form.
	import { resolve } from '$app/paths';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
</script>

<svelte:head>
	<title>Nuevo pedido · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Nuevo pedido" backHref={resolve('/pedidos')} />
	{/snippet}
</Screen>
