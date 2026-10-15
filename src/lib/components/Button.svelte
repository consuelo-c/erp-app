<script lang="ts">
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	// One yellow primary per screen; everything else is secondary.
	type Props = HTMLButtonAttributes &
		HTMLAnchorAttributes & {
			variant?: 'primary' | 'secondary';
			size?: 'xl' | 'md' | 'sm';
			inline?: boolean;
		};

	let { variant = 'primary', size, inline = false, href, children, ...rest }: Props = $props();

	const classes = $derived([
		'btn',
		'secondary' === variant && 'btn--secondary',
		size && `btn--${size}`,
		inline && 'btn--inline'
	]);
</script>

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href built with resolve() -->
	<a {...rest} {href} class={classes}>{@render children?.()}</a>
{:else}
	<button {...rest} class={classes}>{@render children?.()}</button>
{/if}

<style>
	.btn {
		box-sizing: border-box;
		display: flex;
		gap: var(--space-4);
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: var(--space-8);
		margin: 0;
		font: var(--weight-bold) var(--text-lg) / 1.2 var(--font-sans);
		color: var(--action-primary-fg);
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		user-select: none;
		background: var(--action-primary-bg);
		border: var(--border-w) solid var(--action-primary-bg);
		border-radius: var(--radius-card);
	}

	.btn--secondary {
		padding: var(--space-7);
		font-size: var(--text-input);
		font-weight: var(--weight-semibold);
		color: var(--text-body);
		background: transparent;
		border-color: var(--action-secondary-border);
	}

	.btn--xl {
		padding: var(--button-pad-xl);
		font-size: var(--text-button-xl);
	}

	.btn--md {
		padding: var(--space-7);
		font-size: var(--text-input);
	}

	.btn--sm {
		padding: var(--button-pad-sm);
		font-size: var(--text-sm);
	}

	.btn--inline {
		display: inline-flex;
		width: auto;
	}

	/* Full width on a phone; capped on a wide screen so it doesn't stretch across the column. */
	@media (width >= 1024px) {
		.btn {
			max-width: var(--button-max-w);
		}
	}

	/* Hover only where a pointer can hover; touch screens stay unchanged. */
	@media (hover: hover) {
		.btn:hover:not(:disabled, [aria-disabled='true']) {
			background: var(--action-primary-bg-hover);
			border-color: var(--action-primary-bg-hover);
		}

		.btn--secondary:hover:not(:disabled, [aria-disabled='true']) {
			background: var(--surface-subtle);
			border-color: var(--action-secondary-border);
		}
	}

	.btn:disabled,
	.btn[aria-disabled='true'] {
		color: var(--text-disabled);
		cursor: default;
		background: var(--neutral-50);
		border-color: var(--border-default);
	}
</style>
