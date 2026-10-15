<script lang="ts">
	import type { Snippet } from 'svelte';

	// Mobile screen: header, scrolling body, and a footer with the one primary action. On a wide
	// screen the body and the footer's action keep to one centered column.
	interface Props {
		header?: Snippet;
		children: Snippet;
		footer?: Snippet;
	}

	let { header, children, footer }: Props = $props();
</script>

<div class="screen">
	{@render header?.()}
	<main class="screen__body">
		<div class="screen__column">{@render children()}</div>
	</main>
	{#if footer}
		<div class="screen__footer">
			<div class="screen__column screen__actions">{@render footer()}</div>
		</div>
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
		padding: var(--space-8) 0 var(--space-12);
		overflow: auto;
	}

	/* Inside the body, so the scrollbar and the footer's border keep the full width. */
	.screen__column {
		box-sizing: border-box;
		max-width: var(--content-max-w);
		padding-inline: var(--screen-pad-x);
		margin-inline: auto;
	}

	.screen__footer {
		flex: none;
		padding: var(--space-7) 0 var(--space-11);
		background: var(--surface-card);
		border-top: var(--border-w-hair) solid var(--border-default);
	}

	@media (width >= 1024px) {
		.screen__actions {
			display: flex;
			justify-content: flex-end;
		}
	}
</style>
