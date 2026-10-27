<script lang="ts">
	import type { Snippet } from 'svelte';
	import Notice from './Notice.svelte';

	// With `href` the whole card is a link. `head` is the title row, e.g. a name and its Badge.
	// `modified`: an order edited after the warehouse staged it, which has to jump out.
	interface Props {
		href?: string;
		dimmed?: boolean;
		modified?: boolean;
		head?: Snippet;
		children?: Snippet;
	}

	let { href, dimmed = false, modified = false, head, children }: Props = $props();
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	{href}
	class={['card', dimmed && 'card--dimmed', modified && 'card--modified']}
>
	{#if modified}
		<div class="card__notice">
			<Notice tone="warning" strong>⚠ Modificado después de separado</Notice>
		</div>
	{/if}
	{#if head}
		<div class="card__head">{@render head()}</div>
	{/if}
	{@render children?.()}
</svelte:element>

<style>
	.card {
		box-sizing: border-box;
		display: block;
		padding: var(--space-7) var(--space-8);
		margin: 0 0 var(--space-5);
		color: inherit;
		text-decoration: none;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-card);
	}

	a.card {
		cursor: pointer;
	}

	a.card:hover {
		color: inherit;
	}

	/* Not the ink border: ink marks the selected or current item. */
	@media (hover: hover) {
		a.card:hover {
			border-color: var(--neutral-400);
		}
	}

	.card--dimmed {
		opacity: var(--opacity-dimmed);
	}

	.card--modified,
	a.card--modified:hover {
		border: var(--border-w-strong) solid var(--warning-fg);
	}

	.card__notice {
		margin-bottom: var(--space-5);
	}

	.card__head {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-2);
	}
</style>
