<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	// Stacked destinations in a sheet. A row without `href` is a destination whose screens don't
	// exist yet: shown, greyed, not a link. `session` fills the non-link row above them.
	type Row = {
		label: string;
		icon: ComponentProps<typeof Icon>['name'];
		href?: string;
		isCurrent?: boolean;
	};

	let { rows, session }: { rows: Row[]; session?: Snippet } = $props();
</script>

<div class="menu-list">
	{#if session}
		<div class="menu-row menu-row--session">{@render session()}</div>
	{/if}
	{#each rows as row (row.label)}
		{#if row.href}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href built with resolve() -->
			<a class="menu-row" href={row.href} aria-current={row.isCurrent ? 'page' : undefined}>
				<Icon name={row.icon} />{row.label}
			</a>
		{:else}
			<span class="menu-row" aria-disabled="true"><Icon name={row.icon} />{row.label}</span>
		{/if}
	{/each}
</div>

<style>
	.menu-list {
		display: flex;
		flex-direction: column;
	}

	.menu-row {
		box-sizing: border-box;
		display: flex;
		gap: var(--space-6);
		align-items: center;
		min-height: var(--tap-min);
		font: var(--weight-semibold) var(--text-base) / 1.2 var(--font-sans);
		color: var(--text-body);
		text-decoration: none;
		cursor: pointer;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.menu-row:last-child {
		border-bottom: 0;
	}

	.menu-row:hover {
		color: var(--text-body);
	}

	.menu-row[aria-current='page'] {
		font-weight: var(--weight-bold);
	}

	.menu-row[aria-disabled='true'] {
		color: var(--text-disabled);
		cursor: default;
	}

	.menu-row--session {
		justify-content: space-between;
		cursor: default;
	}
</style>
