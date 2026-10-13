<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	// Root screens have no back button; detail screens do. `children` holds the header actions.
	interface Props {
		title?: string;
		backHref?: string;
		children?: Snippet;
	}

	let { title, backHref, children }: Props = $props();
</script>

<header class="screen-header">
	{#if backHref}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href built with resolve() -->
		<a class="screen-header__back" href={backHref} aria-label="Volver"><Icon name="back" /></a>
	{/if}
	{#if title}
		<h1 class="screen-header__title">{title}</h1>
	{/if}
	{@render children?.()}
</header>

<style>
	.screen-header {
		display: flex;
		flex: none;
		gap: var(--space-6);
		align-items: center;
		padding: var(--screen-header-top) var(--screen-pad-x) var(--space-6);
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
</style>
