<script lang="ts">
	import { resolve } from '$app/paths';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import QuoteForm from '../../QuoteForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Editar cotización #{data.quote.id} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader
			title="Editar cotización #{data.quote.id}"
			backHref={resolve('/(app)/cotizaciones/[id]', { id: String(data.quote.id) })}
		/>
	{/snippet}
	<QuoteForm options={data.options} quote={data.quote} {form} />
</Screen>
