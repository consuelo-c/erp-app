<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	// A bare glyph has no visible text, so `label` is its accessible name. With `href` it's a link.
	type Props = HTMLButtonAttributes &
		HTMLAnchorAttributes & {
			icon: ComponentProps<typeof Icon>['name'];
			label: string;
		};

	let { icon, label, href, ...rest }: Props = $props();
</script>

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href built with resolve() -->
	<a {...rest} {href} class="icon-btn" aria-label={label}><Icon name={icon} size="md" /></a>
{:else}
	<button type="button" {...rest} class="icon-btn" aria-label={label}>
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
</style>
