<script lang="ts">
	import type { Snippet } from 'svelte';

	// Warnings advise and never block.
	interface Props {
		tone: 'error' | 'info' | 'success' | 'warning';
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

	.notice--warning {
		color: var(--warning-fg);
		background: var(--warning-bg);
		border-color: var(--warning-border);
	}

	.notice--error {
		color: var(--error-fg);
		background: var(--error-bg);
		border-color: var(--error-bg);
	}

	.notice--success {
		color: var(--success-fg);
		background: var(--success-bg);
		border-color: var(--success-bg);
	}

	.notice--info {
		color: var(--info-fg);
		background: var(--info-bg);
		border-color: var(--info-bg);
	}
</style>
