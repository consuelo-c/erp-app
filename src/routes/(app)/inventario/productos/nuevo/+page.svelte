<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { catalogHref } from '$lib/navigation';
	import ProductForm from '../ProductForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Nuevo producto · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Nuevo producto" backHref={catalogHref(null)} />
	{/snippet}

	<ProductForm product={null} groups={data.groups} {form} />

	<div class="screen__action">
		<Button type="submit" form="product">Guardar producto</Button>
	</div>
</Screen>
