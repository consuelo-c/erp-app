<script lang="ts">
	import type { Snippet } from 'svelte';

	// No tone is the neutral grey (Inactivo, Retirado). Order-state tones arrive with the orders phase.
	interface Props {
		tone?: 'success';
		children: Snippet;
	}

	let { tone, children }: Props = $props();
</script>

<span class={['badge', tone && `badge--${tone}`]}>{@render children()}</span>

<style>
	.badge {
		display: inline-block;
		padding: var(--space-2) var(--space-6);
		font: var(--type-badge);
		color: var(--neutral-600);
		white-space: nowrap;
		background: var(--neutral-50);
		border-radius: var(--radius-pill);
	}

	.badge--success {
		color: var(--success-fg);
		background: var(--success-bg);
	}
</style>
