<script lang="ts">
	import { resolve } from '$app/paths';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { SETTINGS_TABS } from '$lib/navigation';
	import { HELP_MAX_LENGTH } from '$lib/settings';
	import MarkdownEditor from '../MarkdownEditor.svelte';
	import type { PageProps } from './$types';

	// The read view at /ayuda is the preview.
	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Editar ayuda · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={SETTINGS_TABS} current="Ayuda" /></ScreenHeader>
	{/snippet}

	<MarkdownEditor
		id="help"
		label="Texto de la ayuda"
		placeholder="Escribe la ayuda. Cada pregunta empieza con ##"
		heading="Pregunta"
		maxLength={HELP_MAX_LENGTH}
		text={form?.text ?? data.text}
		error={form?.message}
	>
		{#snippet notice()}
			{#if form?.saved}
				<Notice tone="success">
					✓ Guardado · <a class="help-link" href={resolve('/ayuda')}>Ver en Ayuda</a>
				</Notice>
			{/if}
		{/snippet}
	</MarkdownEditor>
</Screen>

<style>
	.help-link {
		font-weight: var(--weight-semibold);
	}
</style>
