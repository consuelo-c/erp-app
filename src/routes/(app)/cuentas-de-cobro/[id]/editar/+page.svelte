<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import IconButton from '$lib/components/IconButton.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import ReceivableForm from '../../ReceivableForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const id = $derived(page.params.id ?? '');
</script>

<svelte:head>
	<title>Editar cuenta de cobro Nº {id} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Editar Nº {id}">
			<IconButton
				icon="close"
				label="Cerrar"
				href={resolve('/(app)/cuentas-de-cobro/[id]', { id })}
			/>
		</ScreenHeader>
	{/snippet}

	<ReceivableForm
		receivable={data.receivable}
		hint="Debe quedar al menos un pedido marcado."
		submitLabel="Guardar cambios"
		failure={form}
	/>
</Screen>
