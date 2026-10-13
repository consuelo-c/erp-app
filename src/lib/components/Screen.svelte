<script lang="ts">
	import type { Snippet } from 'svelte';

	// Mobile screen: header, scrolling body, and a footer with the one primary action.
	interface Props {
		header?: Snippet;
		children: Snippet;
		footer?: Snippet;
	}

	let { header, children, footer }: Props = $props();
</script>

<div class="screen">
	{@render header?.()}
	<main class="screen__body">{@render children()}</main>
	{#if footer}
		<div class="screen__footer">{@render footer()}</div>
	{/if}
</div>

<style>
	.screen {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.screen__body {
		flex: 1;
		min-height: 0;
		padding: var(--space-8) var(--screen-pad-x) var(--space-12);
		overflow: auto;
	}

	.screen__footer {
		flex: none;
		padding: var(--space-7) var(--screen-pad-x) var(--space-11);
		background: var(--surface-card);
		border-top: var(--border-w-hair) solid var(--border-default);
	}
</style>
