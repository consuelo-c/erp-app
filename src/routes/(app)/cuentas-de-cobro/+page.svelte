<script lang="ts">
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
</script>

<!-- STUB: #418 (phase 16) replaces this with the receivable list (42). -->
<svelte:head>
	<title>Cuentas de cobro · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Cuentas de cobro" />
	{/snippet}

	<p class="note">La lista de cuentas de cobro llega pronto.</p>
</Screen>
