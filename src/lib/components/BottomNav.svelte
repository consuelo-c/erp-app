<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import Icon from './Icon.svelte';

	// Mobile navigation, 2 to 4 slots. A slot is a link, a button (the «Más» sheet), or, with
	// neither, a destination whose screens don't exist yet.
	type Item = {
		label: string;
		icon: ComponentProps<typeof Icon>['name'];
		href?: string;
		onclick?: () => void;
		isCurrent?: boolean;
	};

	let { items }: { items: Item[] } = $props();
</script>

<nav class="bottom-nav" aria-label="Principal">
	{#each items as item (item.label)}
		{@const current = item.isCurrent ? 'page' : undefined}
		{#if item.href}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href built with resolve() -->
			<a class="bottom-nav__item" href={item.href} aria-current={current}>
				<Icon name={item.icon} />{item.label}
			</a>
		{:else if item.onclick}
			<button class="bottom-nav__item" type="button" onclick={item.onclick} aria-current={current}>
				<Icon name={item.icon} />{item.label}
			</button>
		{:else}
			<span class="bottom-nav__item" aria-disabled="true">
				<Icon name={item.icon} />{item.label}
			</span>
		{/if}
	{/each}
</nav>

<style>
	.bottom-nav {
		display: flex;
		flex: none;
		padding: var(--space-4) var(--space-2) var(--space-11);
		background: var(--surface-card);
		border-top: var(--border-w-hair) solid var(--border-default);
	}

	.bottom-nav__item {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 3px;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0;
		font: var(--type-nav);
		color: var(--text-disabled);
		text-decoration: none;
		cursor: pointer;
		background: none;
		border: 0;
	}

	.bottom-nav__item:hover {
		color: var(--text-disabled);
	}

	.bottom-nav__item[aria-current='page'] {
		font-weight: var(--weight-bold);
		color: var(--text-body);
	}

	.bottom-nav__item[aria-disabled='true'] {
		cursor: default;
	}
</style>
