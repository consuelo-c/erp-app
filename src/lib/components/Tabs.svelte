<script lang="ts">
	// Sibling views of one section, in place of the screen title. Each tab is a page of its own.
	type Tab = { label: string; href: string };

	let { tabs, current }: { tabs: Tab[]; current: string } = $props();
</script>

<nav class="tabs">
	{#each tabs as tab (tab.href)}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href built with resolve() -->
		<a class="tabs__item" href={tab.href} aria-current={current === tab.label ? 'page' : undefined}>
			{tab.label}
		</a>
	{/each}
</nav>

<style>
	.tabs {
		display: flex;
		flex: 1;
		min-width: 0;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.tabs__item {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-min);
		margin-bottom: calc(-1 * var(--border-w-hair));
		font: var(--type-screen-title);
		color: var(--text-disabled);
		text-decoration: none;
		border-bottom: var(--border-w-strong) solid transparent;
	}

	.tabs__item:hover {
		color: var(--text-disabled);
	}

	.tabs__item[aria-current='page'] {
		color: var(--text-body);
		border-bottom-color: var(--border-strong);
	}
</style>
