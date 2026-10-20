<script lang="ts">
	// STUB: phase 10 replaces this with dispatch (today's route, prep today, deliveries without a route).
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
</script>

<svelte:head>
	<title>Despachos · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Despachos" />
	{/snippet}
</Screen>
