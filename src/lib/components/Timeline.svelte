<script lang="ts">
	import type { Snippet } from 'svelte';

	// The rail and each event's dot. The `<li>`s are the caller's: a `.timeline__title` and a
	// `.timeline__meta`, and whatever the event opens into.
	let { children }: { children: Snippet } = $props();
</script>

<ol class="timeline">
	{@render children()}
</ol>

<style>
	.timeline {
		padding: 0 0 0 var(--space-8);
		margin: 0 0 0 var(--space-3);
		list-style: none;
		border-left: var(--border-w-strong) solid var(--border-default);
	}

	.timeline > :global(li) {
		position: relative;
	}

	.timeline > :global(li + li) {
		margin-top: var(--space-9);
	}

	/* left = -(padding 16 + rule 2 - rule centre 1 + dot half-width 8) = -25px; recompute if the padding changes */
	.timeline > :global(li)::before {
		position: absolute;
		top: 3px;
		left: -25px;
		box-sizing: content-box;
		width: 12px;
		height: 12px;
		content: '';
		background: var(--text-body);
		border: var(--border-w-strong) solid var(--surface-card);
		border-radius: var(--radius-round);
	}

	.timeline :global(.timeline__title) {
		font-weight: var(--weight-bold);
	}

	.timeline :global(.timeline__meta) {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
</style>
