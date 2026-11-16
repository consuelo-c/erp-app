<script lang="ts">
	import { getParentPages, type MenuEntry } from '$lib/navigation';
	import Icon from './Icon.svelte';
	import LogoutButton from './LogoutButton.svelte';

	// Desktop navigation, always expanded: the login's menu tree. The current parent shows its
	// pages below it; any other parent shows them in a flyout on hover or keyboard focus. A
	// parent's list repeats its own page first, as the «Más» sheet does.
	interface Props {
		menu: MenuEntry[];
		/** The open page's href; none on a section outside the menu. */
		currentHref?: string;
		username: string;
	}

	let { menu, currentHref, username }: Props = $props();

	function isOpen({ ownHref, children }: MenuEntry): boolean {
		return (
			undefined !== currentHref &&
			(ownHref === currentHref || children.some(({ href }) => href === currentHref))
		);
	}

	function ariaCurrent(href: string | undefined) {
		return undefined !== currentHref && href === currentHref ? 'page' : undefined;
	}
</script>

<nav class="sidebar" aria-label="Principal">
	<div class="sidebar__brand">
		<img class="sidebar__logo" src="/banquetes-consuelo-c-logo.svg" alt="Banquetes Consuelo C" />
	</div>
	<div class="sidebar__nav">
		{#each menu as parent (parent.label)}
			{@const isParentOpen = isOpen(parent)}
			<div class="sidebar__group">
				{#if 0 === parent.children.length}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- MENU builds its hrefs with resolve() -->
					<a class="sidebar__item" href={parent.href} aria-current={ariaCurrent(parent.ownHref)}>
						<Icon name={parent.icon} size="md" />{parent.label}
					</a>
				{:else}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- MENU builds its hrefs with resolve() -->
					<a class="sidebar__item" href={parent.href}>
						<Icon name={parent.icon} size="md" />{parent.label}
						<span
							class="sidebar__caret"
							class:sidebar__caret--open={isParentOpen}
							aria-hidden="true">›</span
						>
					</a>
					<div class={isParentOpen ? 'sidebar__children' : 'sidebar__flyout'}>
						{#each getParentPages(parent) as child (child.href)}
							<!-- eslint-disable svelte/no-navigation-without-resolve -- MENU builds its hrefs with resolve() -->
							<a
								class="sidebar__item sidebar__item--child"
								href={child.href}
								aria-current={ariaCurrent(child.href)}
							>
								{child.label}
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>
	<div class="sidebar__nav sidebar__foot">
		<!-- Offline the shell draws with no session to name. -->
		{#if username}<div class="sidebar__session">Sesión: {username}</div>{/if}
		<LogoutButton>
			{#snippet trigger(open)}
				<button class="sidebar__item" type="button" onclick={open}>
					<Icon name="exit" size="md" />Cerrar sesión
				</button>
			{/snippet}
		</LogoutButton>
	</div>
</nav>

<style>
	.sidebar {
		box-sizing: border-box;
		display: flex;
		flex: none;
		flex-direction: column;
		width: var(--sidebar-w);

		/* Taller than the window, the menu grows the page rather than scroll inside: a scrolling
		   sidebar would clip the flyouts. */
		min-height: 100%;
		background: var(--surface-sidebar);
	}

	.sidebar__brand {
		display: flex;
		align-items: center;
		padding: var(--space-10) var(--space-9);
		border-bottom: var(--border-w-hair) solid var(--border-sidebar);
	}

	/* The logo file draws in currentColor, which an <img> renders black: the sidebar needs it white. */
	.sidebar__logo {
		display: block;
		width: 100px;
		height: auto;
		filter: brightness(0) invert(1);
	}

	.sidebar__nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-7) var(--space-5);
	}

	.sidebar__group,
	.sidebar__children {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
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

	/* A page under a parent: regular weight, so it doesn't read as an item missing its icon. */
	.sidebar__item--child,
	.sidebar__item--child[aria-current='page'] {
		font-weight: var(--weight-regular);
	}

	/* Aligned with the parent's label: its padding, its 18px icon and the gap. */
	.sidebar__children > .sidebar__item--child {
		padding-left: calc(2 * var(--space-6) + 18px);
	}

	/* A parent with pages under it: the caret points at the flyout, and down once they're open. */
	.sidebar__caret {
		margin-left: auto;
		font-size: 22px;
		font-weight: var(--weight-regular);
		line-height: 0;
		color: var(--neutral-400);
	}

	.sidebar__caret--open {
		transform: rotate(90deg);
	}

	.sidebar__flyout {
		position: absolute;
		top: 0;
		left: calc(100% + var(--space-5));
		z-index: var(--z-modal);
		display: none;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 200px;
		padding: var(--space-3);
		background: var(--surface-sidebar);
		border-radius: var(--radius-md);
	}

	/* Bridges the gap to the flyout, so moving the pointer onto it doesn't close it. */
	.sidebar__flyout::before {
		position: absolute;
		top: 0;
		right: 100%;
		bottom: 0;
		width: var(--space-5);
		content: '';
	}

	.sidebar__group:hover > .sidebar__flyout,
	.sidebar__group:focus-within > .sidebar__flyout {
		display: flex;
	}

	.sidebar__group:hover:has(> .sidebar__flyout) > .sidebar__item,
	.sidebar__group:focus-within:has(> .sidebar__flyout) > .sidebar__item {
		background: var(--neutral-800);
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
</style>
