<script lang="ts">
	import type { Snippet } from 'svelte';

	// Warnings advise and never block; the warning, success and info tones arrive with the screens that use them.
	interface Props {
		tone: 'error';
		children: Snippet;
	}

	let { tone, children }: Props = $props();
</script>

<div class={['notice', `notice--${tone}`]} role="alert">{@render children()}</div>

<style>
	.notice {
		padding: var(--space-5) var(--space-6);
		font: var(--weight-semibold) var(--text-sm) / 1.4 var(--font-sans);
		border: var(--border-w) solid;
		border-radius: var(--radius-md);
	}

	.notice--error {
		color: var(--error-fg);
		background: var(--error-bg);
		border-color: var(--error-bg);
	}
</style>
