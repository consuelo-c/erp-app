<script lang="ts">
	import Notice from '$lib/components/Notice.svelte';
	import { formatInstant } from '$lib/datetime';
	import type { Overlap } from '$lib/server/services/inventory';

	// Other pending counts sharing products with this one: a warning before approving, never a block.
	let { overlaps }: { overlaps: Overlap[] } = $props();

	function overlapText(overlap: Overlap): string {
		const who = `${overlap.createdBy} · ${formatInstant(overlap.createdAt)}`;
		return `El conteo #${overlap.id} (${who}) también cuenta ${overlap.products.join(', ')}.`;
	}
</script>

<Notice tone="warning">
	{#each overlaps as overlap (overlap.id)}
		<span class="block">⚠ {overlapText(overlap)}</span>
	{/each}
	<span class="block">Puedes aprobar igual.</span>
</Notice>

<style>
	.block {
		display: block;
	}

	.block + .block {
		margin-top: var(--space-2);
	}
</style>
