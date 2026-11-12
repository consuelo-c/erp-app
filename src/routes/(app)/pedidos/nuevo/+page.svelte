<script lang="ts">
	import { resolve } from '$app/paths';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import OrderForm from '../OrderForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Nuevo pedido · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Nuevo pedido" backHref={resolve('/pedidos')} />
	{/snippet}
	{#if null === data.refusal}
		<OrderForm options={data.options} order={null} conversion={data.conversion} {form} />
	{:else}
		<Notice tone="info">
			{data.refusal}
			{#if data.quoteId}
				<a href={resolve('/(app)/cotizaciones/[id]', { id: String(data.quoteId) })}
					>Ver la cotización #{data.quoteId}</a
				>
			{:else}
				<a href={resolve('/cotizaciones')}>Ir a Cotizaciones</a>
			{/if}
		</Notice>
	{/if}
</Screen>
