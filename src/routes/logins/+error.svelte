<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import LogoutButton from '$lib/components/LogoutButton.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';

	// A MANAGER reaching a Logins URL sees why, inside the screen, instead of a bare error page.
	const isForbidden = $derived(403 === page.status);
</script>

<svelte:head>
	<title>Logins · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Logins" backHref={resolve('/personal')}>
			<LogoutButton />
		</ScreenHeader>
	{/snippet}

	{#if isForbidden}
		<Notice tone="info">No tienes permiso para esta sección</Notice>
	{:else}
		<Notice tone="error">{page.error?.message}</Notice>
	{/if}
</Screen>
