<script lang="ts">
	import { page } from '$app/state';

	// An unknown token, a draft, or an event more than a week past: one page for every case, the
	// contact beside it in the layout.
</script>

<svelte:head>
	<title>Banquetes Consuelo C</title>
</svelte:head>

<h1 class="unavailable">{page.error?.message}</h1>

<style>
	.unavailable {
		margin: 48px 0 0;
		font-size: var(--text-2xl);
		font-weight: var(--weight-bold);
		text-align: center;
		text-wrap: balance;
	}
</style>
