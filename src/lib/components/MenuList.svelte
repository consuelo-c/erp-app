<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getParentPages, hasSheetList, type MenuEntry } from '$lib/navigation';
	import Icon from './Icon.svelte';

	// The «Más» sheet's menu tree. The first list is the session row, then the parents; a parent
	// with a list of its own slides it in from the right, ending with «Volver».
	interface Props {
		menu: MenuEntry[];
		/** The open page's href; none on a section outside the menu. */
		currentHref?: string;
		/** The parent whose list is, or was last, slid in. */
		parentLabel?: string;
		isParentListOpen: boolean;
		session: Snippet;
	}

	let {
		menu,
		currentHref,
		parentLabel = $bindable(),
		isParentListOpen = $bindable(),
		session
	}: Props = $props();

	const parent = $derived(menu.find(({ label }) => label === parentLabel));

	function ariaCurrent(href: string) {
		return href === currentHref ? 'page' : undefined;
	}

	function openList(label: string) {
		parentLabel = label;
		isParentListOpen = true;
	}
</script>

<div class="bottom-sheet__viewport">
	<div class={['bottom-sheet__track', isParentListOpen && 'bottom-sheet__track--sub']}>
		<div class="menu-list" inert={isParentListOpen}>
			<div class="menu-row menu-row--session">{@render session()}</div>
			{#each menu as entry (entry.label)}
				{#if hasSheetList(entry)}
					<button class="menu-row" type="button" onclick={() => openList(entry.label)}>
						<Icon name={entry.icon} />{entry.label}
						<span class="menu-row__chevron" aria-hidden="true">›</span>
					</button>
				{:else}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- MENU builds its hrefs with resolve() -->
					<a class="menu-row" href={entry.href} aria-current={ariaCurrent(entry.href)}>
						<Icon name={entry.icon} />{entry.label}
					</a>
				{/if}
			{/each}
		</div>
		<div class="menu-list" inert={!isParentListOpen}>
			{#if parent}
				{#each getParentPages(parent) as page (page.href)}
					{@const isOwnPage = page.href === parent.ownHref}
					{@const rowClass = ['menu-row', parent.ownHref && !isOwnPage && 'menu-row--child']}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- MENU builds its hrefs with resolve() -->
					<a class={rowClass} href={page.href} aria-current={ariaCurrent(page.href)}>
						{#if isOwnPage}<Icon name={parent.icon} />{/if}{page.label}
					</a>
				{/each}
			{/if}
			<button
				class="menu-row menu-row--back"
				type="button"
				onclick={() => (isParentListOpen = false)}
			>
				<Icon name="back" />Volver
			</button>
		</div>
	</div>
</div>

<style>
	.bottom-sheet__viewport {
		overflow: hidden;
	}

	/* The two lists side by side; --sub slides the parent's list in from the right. */
	.bottom-sheet__track {
		display: flex;
		width: 200%;
		transition: transform 0.25s ease;
	}

	.bottom-sheet__track--sub {
		transform: translateX(-50%);
	}

	@media (prefers-reduced-motion: reduce) {
		.bottom-sheet__track {
			transition: none;
		}
	}

	.menu-list {
		box-sizing: border-box;
		display: flex;
		flex: none;
		flex-direction: column;
		width: 50%;
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

	.menu-row:last-child,
	.menu-row:has(+ .menu-row--back) {
		border-bottom: 0;
	}

	.menu-row:hover {
		color: var(--text-body);
	}

	.menu-row[aria-current='page'] {
		font-weight: var(--weight-bold);
	}

	.menu-row--session {
		justify-content: space-between;
		cursor: default;
	}

	button.menu-row {
		width: 100%;
		padding: 0;
		text-align: left;
		background: none;
		border-color: var(--border-default);
		border-style: solid;
		border-width: 0 0 var(--border-w-hair);
	}

	.menu-row__chevron {
		padding-right: var(--space-2);
		margin-left: auto;
		font-size: 22px;
		font-weight: var(--weight-regular);
		color: var(--text-secondary);
	}

	/* Aligned with the parent's label above: its icon and the gap. */
	.menu-row--child {
		padding-left: calc(var(--icon-size) + var(--space-6));
	}

	/* As tall as the first list, «Volver» sits at the bottom, within the thumb's reach. */
	button.menu-row--back {
		margin-top: auto;
		border-top: var(--border-w-strong) solid var(--border-default);
	}
</style>
