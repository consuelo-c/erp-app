<script lang="ts">
	// STUB: phase 4 replaces this with the shell.
	import LogoutButton from '$lib/components/LogoutButton.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Inicio · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	<p>Hola, <strong>{data.username}</strong></p>

	{#snippet footer()}
		<LogoutButton />
	{/snippet}
</Screen>
