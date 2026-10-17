<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { findDestination } from '$lib/navigation';

	// An error inside the shell, its navigation still usable. A 403 is a section outside the login's
	// roles: the header names the section, the body says why.
	const isForbidden = $derived(403 === page.status);
	const title = $derived(
		isForbidden ? (findDestination(page.url.pathname)?.label ?? 'Acceso restringido') : 'Error'
	);
</script>

<svelte:head>
	<title>{title} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader {title} backHref={resolve('/despachos')} />
	{/snippet}

	{#if isForbidden}
		<Notice tone="info">No tienes permiso para esta sección</Notice>
	{:else}
		<Notice tone="error">{page.error?.message}</Notice>
	{/if}
</Screen>
