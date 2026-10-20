<script lang="ts">
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { CASH_TABS } from '$lib/navigation';
</script>

<svelte:head>
	<title>Registrar movimiento · Banquetes Consuelo C</title>
</svelte:head>

<!-- STUB: unit #194 (Registrar movimiento, phase 07) replaces this with the movement entry form. -->
<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={CASH_TABS} current="Registrar movimiento" /></ScreenHeader>
	{/snippet}

	<Notice tone="info">Aquí se registrarán los movimientos que no vienen de la nómina.</Notice>
</Screen>
