<script lang="ts">
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { SETTINGS_TABS } from '$lib/navigation';
	import type { PageProps } from './$types';
	import SettingsForm from '../SettingsForm.svelte';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Configuración de nómina · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={SETTINGS_TABS} current="Nómina" /></ScreenHeader>
	{/snippet}

	<SettingsForm settings={data.settings} {form}>
		<Notice tone="warning">
			⚠ Estos valores calculan toda la nómina. Un error aquí la desajusta: revisa cada cambio antes
			de guardar.
		</Notice>
	</SettingsForm>
</Screen>
