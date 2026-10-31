<script lang="ts">
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { SETTINGS_TABS } from '$lib/navigation';
	import { TERMS_MAX_LENGTH } from '$lib/settings';
	import MarkdownEditor from '../MarkdownEditor.svelte';
	import type { PageProps } from './$types';

	// What the client's page shows under the order; empty, it shows no section.
	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Editar términos y condiciones · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={SETTINGS_TABS} current="Términos" /></ScreenHeader>
	{/snippet}

	<MarkdownEditor
		id="terms"
		label="Términos y condiciones del pedido"
		placeholder="Escribe los términos y condiciones que el cliente ve en su pedido. Vacío, no se muestran"
		heading="Título"
		maxLength={TERMS_MAX_LENGTH}
		text={form?.text ?? data.text}
		error={form?.message}
	>
		{#snippet notice()}
			{#if form?.saved}
				<Notice tone="success">✓ Guardado</Notice>
			{/if}
		{/snippet}
	</MarkdownEditor>
</Screen>
