<script lang="ts">
	import type { Snippet } from 'svelte';

	// Mobile screen: header, scrolling body, and a fixed footer with the one primary action, only on
	// screens without the bottom navigation. On a wide screen the body and the footer's action keep
	// to one centered column; `wide` widens it from 1280px, for a screen with a side column.
	interface Props {
		header?: Snippet;
		children?: Snippet;
		footer?: Snippet;
		wide?: boolean;
	}

	let { header, children, footer, wide = false }: Props = $props();
</script>

<div class="screen" class:screen--wide={wide}>
	{@render header?.()}
	<main class="screen__body">{@render children?.()}</main>
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

	/* The side padding grows past the column's width, so the scrollbar and the footer's border
	   keep the full width. */
	.screen__body,
	.screen__footer {
		padding-inline: max(
			var(--screen-pad-x),
			calc((100% - var(--content-max-w)) / 2 + var(--screen-pad-x))
		);
	}

	.screen__body {
		flex: 1;
		min-height: 0;
		padding-block: var(--space-8) var(--space-12);
		overflow: auto;
	}

	.screen__footer {
		flex: none;
		padding-block: var(--space-7) var(--space-11);
		background: var(--surface-card);
		border-top: var(--border-w-hair) solid var(--border-default);
	}

	@container (width >= 1280px) {
		.screen--wide {
			--content-max-w: var(--content-max-w-wide);
		}
	}

	@container (width >= 1024px) {
		.screen__footer {
			display: flex;
			flex-direction: column;
			align-items: flex-end;
		}
	}
</style>
