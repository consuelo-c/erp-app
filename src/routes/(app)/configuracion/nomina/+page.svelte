<script lang="ts">
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import type { PageProps } from './$types';
	import SettingsForm from '../SettingsForm.svelte';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Configuración de nómina · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Nómina" />
	{/snippet}

	<SettingsForm settings={data.settings} {form}>
		<Notice tone="warning">
			⚠ Estos valores calculan toda la nómina. Un error aquí la desajusta: revisa cada cambio antes
			de guardar.
		</Notice>
	</SettingsForm>
</Screen>
