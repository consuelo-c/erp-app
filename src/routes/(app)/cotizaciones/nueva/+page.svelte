<script lang="ts">
	import { resolve } from '$app/paths';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import QuoteForm from '../QuoteForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Nueva cotización · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Nueva cotización" backHref={resolve('/cotizaciones')} />
	{/snippet}
	<QuoteForm options={data.options} quote={null} {form} />
</Screen>
