<script lang="ts">
	import Chip from '$lib/components/Chip.svelte';
	import Choice from '$lib/components/Choice.svelte';

	// The office printer only takes half-letter fed landscape: Horizontal turns each printed page a
	// quarter turn onto it, Vertical prints portrait (e.g. to save a PDF). The screen never turns,
	// and nothing is remembered: every printout opens on Horizontal. Chrome and Edge only.
	let { isHorizontal = $bindable(true) }: { isHorizontal?: boolean } = $props();
</script>

<svelte:head>
	{#if isHorizontal}
		<style>
			@page {
				page-orientation: rotate-left;
			}
		</style>
	{/if}
</svelte:head>

<Choice aria-label="Orientación">
	<Chip
		type="radio"
		name="orientation"
		size="sm"
		label="Horizontal"
		checked={isHorizontal}
		onchange={() => (isHorizontal = true)}
	/>
	<Chip
		type="radio"
		name="orientation"
		size="sm"
		label="Vertical"
		checked={!isHorizontal}
		onchange={() => (isHorizontal = false)}
	/>
</Choice>
