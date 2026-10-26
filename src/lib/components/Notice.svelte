<script lang="ts">
	import type { Snippet } from 'svelte';

	// Warnings advise and never block. `strong` is a one-line notice that must jump out.
	interface Props {
		tone: 'error' | 'info' | 'success' | 'warning';
		strong?: boolean;
		children: Snippet;
	}

	let { tone, strong = false, children }: Props = $props();
</script>

<div class={['notice', `notice--${tone}`, strong && 'notice--strong']} role="alert">
	{@render children()}
</div>

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

	.notice--strong {
		font-weight: var(--weight-bold);
	}
</style>
