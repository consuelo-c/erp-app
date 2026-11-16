<script lang="ts">
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import type { PageProps } from './$types';
	import SettingsForm from './SettingsForm.svelte';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Configuración general · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Configuración" />
	{/snippet}

	<SettingsForm settings={data.settings} {form} />
</Screen>
