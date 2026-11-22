<script lang="ts">
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import CashStatementView from './CashStatementView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Efectivo por entregar · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Efectivo por entregar" />
	{/snippet}

	<CashStatementView
		statement={data.statement}
		cardHint="Todo el efectivo que has recibido, menos lo que ya entregaste en la oficina."
		footnote="Las entregas las registra el Gerente cuando le llevas el efectivo."
	/>
</Screen>
