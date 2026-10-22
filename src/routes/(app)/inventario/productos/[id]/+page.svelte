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
	<title>{data.product.name} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<!-- Back where it's listed: its group's variants, or the list. -->
		<ScreenHeader title="Editar producto" backHref={catalogHref(data.product.variantGroup)} />
	{/snippet}

	<ProductForm product={data.product} groups={data.groups} {form} />

	<div class="screen__action">
		<Button type="submit" form="product">Guardar cambios</Button>
	</div>
</Screen>
