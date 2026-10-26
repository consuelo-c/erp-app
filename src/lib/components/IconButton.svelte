<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	// A bare glyph has no visible text, so `label` is its accessible name. With `href` it's a link.
	// `lg` is the 48px hit area of the driver's and the warehouse's screens.
	type Props = HTMLButtonAttributes &
		HTMLAnchorAttributes & {
			icon: ComponentProps<typeof Icon>['name'];
			label: string;
			size?: 'lg';
		};

	let { icon, label, size, href, ...rest }: Props = $props();

	const classes = $derived(['icon-btn', size && `icon-btn--${size}`]);
</script>

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href built with resolve() -->
	<a {...rest} {href} class={classes} aria-label={label}><Icon name={icon} size="md" /></a>
{:else}
	<button type="button" {...rest} class={classes} aria-label={label}>
		<Icon name={icon} size="md" />
	</button>
{/if}

<style>
	/* 44px hit area around the glyph; the negative margin keeps it from pushing the layout. */
	.icon-btn {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		padding: 0;
		margin: -12px;
		color: inherit;
		cursor: pointer;
		background: none;
		border: 0;
	}

	.icon-btn--lg {
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		margin: -14px;
	}
</style>
