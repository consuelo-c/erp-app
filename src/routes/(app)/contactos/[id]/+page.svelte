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
	<title>{data.contact.fullName} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title={data.contact.fullName} backHref={resolve('/contactos')} />
	{/snippet}

	<!-- Keyed: «Abrir contacto» moves to another contact on the same route, with a fresh form. -->
	{#key data.contact.id}
		<ContactForm contact={data.contact} isManager={data.isManager} {form} />
	{/key}

	<div class="screen__action">
		<Button type="submit" form="contact">Guardar cambios</Button>
	</div>
</Screen>
