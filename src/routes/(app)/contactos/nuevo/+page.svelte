<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import ContactForm from '../ContactForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Nuevo contacto · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Nuevo contacto" backHref={resolve('/contactos')} />
	{/snippet}

	<ContactForm contact={null} isManager={data.isManager} {form} />

	<div class="screen__action">
		<Button type="submit" form="contact">Guardar contacto</Button>
	</div>
</Screen>
