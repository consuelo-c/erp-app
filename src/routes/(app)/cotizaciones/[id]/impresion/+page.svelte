<script lang="ts">
	import { resolve } from '$app/paths';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';

	// STUB: Phase 13's #402 replaces this with the half-letter quote printout.
</script>

<svelte:head>
	<title>Imprimir cotización · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Imprimir cotización" backHref={resolve('/cotizaciones')} />
	{/snippet}
	<Notice tone="info">Esta pantalla todavía no está lista.</Notice>
</Screen>
