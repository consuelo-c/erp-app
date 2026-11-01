<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLFieldsetAttributes } from 'svelte/elements';

	// A labelled group of radio Chips, a fieldset like the ClockField. `layout`: `grid` shares the row
	// among the chips, `scroll` lets them run past it, `stack` puts one per line, `none` leaves the
	// options to `children`, e.g. the order form's client cards. Without a `legend`, an `aria-label`.
	type Props = HTMLFieldsetAttributes & {
		legend?: string;
		layout?: 'grid' | 'scroll' | 'stack' | 'none';
		hint?: string;
		strongHint?: boolean;
		children: Snippet;
	};

	let { legend, layout = 'grid', hint, strongHint = false, children, ...rest }: Props = $props();

	const OPTIONS_CLASSES = { grid: 'choice__options', scroll: 'chip-row', stack: 'choice__stack' };
</script>

<fieldset {...rest} class="choice">
	{#if legend}
		<legend class="choice__legend">{legend}</legend>
	{/if}
	{#if 'none' === layout}
		{@render children()}
	{:else}
		<div class={OPTIONS_CLASSES[layout]}>{@render children()}</div>
	{/if}
	{#if hint}
		<p class={['choice__hint', strongHint && 'choice__hint--strong']}>{hint}</p>
	{/if}
</fieldset>

<style>
	.choice {
		min-width: 0;
		padding: 0;
		margin: 0;
		border: 0;
	}

	/* The same look as a Field's label and hint. */
	.choice__legend {
		padding: 0;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	.choice__hint {
		margin: var(--space-3) 0 0;
		font-size: var(--text-label);
		font-style: italic;
		color: var(--text-secondary);
	}

	/* What the choice changes, e.g. what leaves inventory, reads louder. */
	.choice__hint--strong {
		font-weight: var(--weight-semibold);
		color: var(--text-body);
	}

	/* The chips share the row, each a full tap target. */
	.choice__options {
		display: grid;
		grid-auto-columns: 1fr;
		grid-auto-flow: column;
		gap: var(--space-4);
	}

	.choice__options > :global(.chip) {
		justify-content: center;
		min-height: var(--tap-min);
	}

	/* A locked option, e.g. a correction's Tipo, reads as unavailable. */
	.choice__options > :global(.chip:has(input:disabled)) {
		color: var(--text-disabled);
		cursor: default;
	}

	.choice__stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.choice__stack > :global(.chip) {
		min-height: var(--tap-min);
	}
</style>
