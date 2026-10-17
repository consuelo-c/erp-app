<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';

	// An error outside the shell (401, 404, 500): there may be no session, so it leads to the landing.
	// A 403 can only come from a section inside the shell, whose own error screen shows it.
</script>

<svelte:head>
	<title>Error · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Error" backHref={resolve('/')} />
	{/snippet}

	<Notice tone="error">{page.error?.message}</Notice>
</Screen>
