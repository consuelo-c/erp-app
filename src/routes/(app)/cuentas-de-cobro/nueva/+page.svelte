<script lang="ts">
	import { resolve } from '$app/paths';
	import IconButton from '$lib/components/IconButton.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import ReceivableForm from '../ReceivableForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const startingOrderId = $derived(data.receivable?.checkedOrderIds[0]);
	const closeHref = $derived(
		undefined === startingOrderId
			? resolve('/pedidos')
			: resolve('/(app)/pedidos/[id]', { id: String(startingOrderId) })
	);
</script>

<svelte:head>
	<title>Emitir cuenta de cobro · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Emitir cuenta de cobro">
			<IconButton icon="close" label="Cerrar" href={closeHref} />
		</ScreenHeader>
	{/snippet}

	{#if data.receivable}
		<p class="meta lead">Desde el pedido #{startingOrderId}</p>
		<ReceivableForm
			receivable={data.receivable}
			hint="Los pedidos del cliente que no están cancelados ni en otra cuenta de cobro. Debe quedar al menos uno marcado."
			submitLabel="Emitir cuenta de cobro"
			failure={form}
		/>
	{:else}
		<Notice tone="error">
			La cuenta de cobro se emite desde un pedido que no esté cancelado ni en otra cuenta.
		</Notice>
	{/if}
</Screen>

<style>
	.lead {
		margin: 0 0 var(--space-8);
	}
</style>
