<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	// Root screens have no back button; detail screens do. `actions` holds the icons that sit by the
	// title, `children` what goes at the row's end.
	interface Props {
		title?: string;
		backHref?: string;
		actions?: Snippet;
		children?: Snippet;
	}

	let { title, backHref, actions, children }: Props = $props();
</script>

<header class="screen-header">
	{#if backHref}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href built with resolve() -->
		<a class="screen-header__back" href={backHref} aria-label="Volver"><Icon name="back" /></a>
	{/if}
	{#if title}
		<h1 class="screen-header__title">{title}</h1>
	{/if}
	{#if actions}
		<div class="screen-header__actions">{@render actions()}</div>
	{/if}
	{@render children?.()}
</header>

<style>
	/* The same side padding as the screen's body, so the title starts where its column does. */
	.screen-header {
		display: flex;
		flex: none;
		gap: var(--space-6);
		align-items: center;
		padding: var(--screen-header-top)
			max(var(--screen-pad-x), calc((100% - var(--content-max-w)) / 2 + var(--screen-pad-x)))
			var(--space-6);
	}

	.screen-header__back {
		display: grid;
		flex: none;
		place-items: center;
		width: var(--back-btn);
		height: var(--back-btn);
		padding: 0;
		color: var(--text-body);
		cursor: pointer;
		background: var(--surface-subtle);
		border: 0;
		border-radius: var(--radius-round);
	}

	.screen-header__title {
		flex: 1;
		min-width: 0;
		margin: 0;
		font: var(--type-screen-title);
	}

	/* On a phone the icons and what follows them drop to a second row rather than squeeze the title. */
	.screen-header:has(> .screen-header__actions) {
		flex-wrap: wrap;
	}

	.screen-header__title:has(+ .screen-header__actions) {
		flex: 0 1 auto;
	}

	/* 24px apart: each icon's 44px hit area overhangs its glyph by 12px on either side. */
	.screen-header__actions {
		display: flex;
		flex: 1 0 auto;
		gap: var(--space-12);
		align-items: center;
	}
</style>
