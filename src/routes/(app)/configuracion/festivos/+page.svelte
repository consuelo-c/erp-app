<script lang="ts">
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { SETTINGS_TABS } from '$lib/navigation';
</script>

<svelte:head>
	<title>Festivos · Banquetes Consuelo C</title>
</svelte:head>

<!-- STUB: #154 (phase 6) replaces this with the holidays editor. -->
<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={SETTINGS_TABS} current="Festivos" /></ScreenHeader>
	{/snippet}

	<p class="note">El editor de festivos todavía no está disponible.</p>
</Screen>
