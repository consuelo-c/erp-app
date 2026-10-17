<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import Icon from './Icon.svelte';
	import LogoutButton from './LogoutButton.svelte';

	// Desktop navigation, the same destinations as the bottom bar. Collapsed it's a 68px icon rail,
	// each item named by its `title`. An item without `href` is a destination whose screens don't
	// exist yet: shown, not a link.
	type Item = {
		label: string;
		icon: ComponentProps<typeof Icon>['name'];
		href?: string;
		isCurrent?: boolean;
	};

	interface Props {
		items: Item[];
		footItems: Item[];
		username: string;
		isCollapsed?: boolean;
	}

	let { items, footItems, username, isCollapsed = $bindable(false) }: Props = $props();
</script>

<nav class={['sidebar', isCollapsed && 'sidebar--collapsed']} aria-label="Principal">
	<div class="sidebar__brand">
		<img class="sidebar__logo" src="/banquetes-consuelo-c-logo.svg" alt="Banquetes Consuelo C" />
		<img class="sidebar__mark" src="/c-logo.svg" alt="Consuelo C" />
		<button
			class="sidebar__toggle"
			type="button"
			aria-label={isCollapsed ? 'Expandir menú' : 'Contraer menú'}
			aria-expanded={!isCollapsed}
			onclick={() => (isCollapsed = !isCollapsed)}
		>
			<Icon name="collapse" size="md" />
		</button>
	</div>
	<div class="sidebar__nav">
		{#each items as item (item.label)}
			{@render sidebarItem(item)}
		{/each}
	</div>
	<div class="sidebar__nav sidebar__foot">
		{#each footItems as item (item.label)}
			{@render sidebarItem(item)}
		{/each}
		<div class="sidebar__session">Sesión: {username}</div>
		<LogoutButton>
			{#snippet trigger(open)}
				<button
					class="sidebar__item"
					type="button"
					title="Cerrar sesión ({username})"
					onclick={open}
				>
					<Icon name="exit" size="md" /><span class="sidebar__label">Cerrar sesión</span>
				</button>
			{/snippet}
		</LogoutButton>
	</div>
</nav>

{#snippet sidebarItem(item: Item)}
	{@const current = item.isCurrent ? 'page' : undefined}
	{#if item.href}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href built with resolve() -->
		<a class="sidebar__item" href={item.href} title={item.label} aria-current={current}>
			<Icon name={item.icon} size="md" /><span class="sidebar__label">{item.label}</span>
		</a>
	{:else}
		<span class="sidebar__item" title={item.label} aria-disabled="true">
			<Icon name={item.icon} size="md" /><span class="sidebar__label">{item.label}</span>
		</span>
	{/if}
{/snippet}

<style>
	.sidebar {
		box-sizing: border-box;
		display: flex;
		flex: none;
		flex-direction: column;
		width: var(--sidebar-w);
		height: 100%;
		background: var(--surface-sidebar);
	}

	.sidebar__brand {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-10) var(--space-9);
		border-bottom: var(--border-w-hair) solid var(--border-sidebar);
	}

	/* The logo files draw in currentColor, which an <img> renders black: the rail needs them white. */
	.sidebar__logo,
	.sidebar__mark {
		filter: brightness(0) invert(1);
	}

	.sidebar__logo {
		display: block;
		width: 100px;
		height: auto;
	}

	.sidebar__mark {
		display: none;
		width: auto;
		height: 24px;
	}

	.sidebar__toggle {
		display: flex;
		padding: 0;
		color: var(--neutral-400);
		cursor: pointer;
		background: none;
		border: 0;
	}

	.sidebar__nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-7) var(--space-5);
	}

	.sidebar__item {
		display: flex;
		gap: var(--space-6);
		align-items: center;
		padding: var(--space-6);
		font: var(--weight-semibold) var(--text-md) / 1.2 var(--font-sans);
		color: var(--text-on-dark);
		text-decoration: none;
		cursor: pointer;
		border-radius: var(--radius-md);
	}

	.sidebar__item:hover {
		color: var(--text-on-dark);
	}

	.sidebar__item[aria-current='page'] {
		font-weight: var(--weight-bold);
		color: var(--neutral-900);
		background: var(--brand-yellow);
	}

	.sidebar__item[aria-disabled='true'] {
		color: var(--neutral-600);
		cursor: default;
	}

	/* «Cerrar sesión» is a button among the links. */
	button.sidebar__item {
		width: 100%;
		text-align: left;
		background: none;
		border: 0;
	}

	.sidebar__foot {
		margin-top: auto;
		border-top: var(--border-w-hair) solid var(--border-sidebar);
	}

	.sidebar__session {
		padding: var(--space-6) var(--space-6) var(--space-1);
		font: var(--weight-semibold) var(--text-label) / 1.2 var(--font-sans);
		color: var(--neutral-400);
	}

	.sidebar--collapsed {
		width: var(--sidebar-w-collapsed);
	}

	.sidebar--collapsed .sidebar__brand {
		justify-content: center;
		padding: var(--space-10) 0;
	}

	.sidebar--collapsed .sidebar__logo,
	.sidebar--collapsed .sidebar__session,
	.sidebar--collapsed .sidebar__label,
	.sidebar--collapsed .sidebar__toggle :global(.icon) {
		display: none;
	}

	.sidebar--collapsed .sidebar__mark {
		display: block;
	}

	/* Collapsed, the whole brand area is the toggle. */
	.sidebar--collapsed .sidebar__toggle {
		position: absolute;
		inset: 0;
	}

	.sidebar--collapsed .sidebar__nav {
		gap: var(--space-3);
		align-items: center;
		padding: var(--space-7) 0;
	}

	.sidebar--collapsed .sidebar__item {
		justify-content: center;
		width: var(--sidebar-item);
		height: var(--sidebar-item);
		padding: 0;
	}
</style>
