<script lang="ts">
	import { resolve } from '$app/paths';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';

	// STUB: Phase 13's #397 replaces this with the quote's detail.
</script>

<svelte:head>
	<title>Cotización · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Cotización" backHref={resolve('/cotizaciones')} />
	{/snippet}
	<Notice tone="info">Esta pantalla todavía no está lista.</Notice>
</Screen>
