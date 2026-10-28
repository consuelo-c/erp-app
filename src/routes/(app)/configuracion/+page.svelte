<script lang="ts">
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { SETTINGS_TABS } from '$lib/navigation';
	import type { PageProps } from './$types';
	import SettingsForm from './SettingsForm.svelte';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Configuración general · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={SETTINGS_TABS} current="General" /></ScreenHeader>
	{/snippet}

	<SettingsForm settings={data.settings} {form} />
</Screen>
