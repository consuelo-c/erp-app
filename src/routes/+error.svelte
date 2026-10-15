<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import LogoutButton from '$lib/components/LogoutButton.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';

	// Every route's error screen. A 403 means a session without the role: it says why and leads back
	// to /inicio. Anything else (401, 404, 500) may have no session, so it leads to the landing.
	const isForbidden = $derived(403 === page.status);
</script>

<svelte:head>
	<title>{isForbidden ? 'Acceso restringido' : 'Error'} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader
			title={isForbidden ? 'Acceso restringido' : 'Error'}
			backHref={isForbidden ? resolve('/inicio') : resolve('/')}
		>
			{#if isForbidden}
				<LogoutButton />
			{/if}
		</ScreenHeader>
	{/snippet}

	{#if isForbidden}
		<Notice tone="info">No tienes permiso para esta sección</Notice>
	{:else}
		<Notice tone="error">{page.error?.message}</Notice>
	{/if}
</Screen>
