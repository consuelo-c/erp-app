<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import LogoutButton from '$lib/components/LogoutButton.svelte';
	import MenuList from '$lib/components/MenuList.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import { findCurrentHref, findSheetParent, getBarSlots, getMenu } from '$lib/navigation';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	let isMoreOpen = $state(false);

	// The sheet's rows are links: leaving the page closes it.
	afterNavigate(() => {
		isMoreOpen = false;
	});

	const menu = $derived(getMenu(data.roles));
	// A section outside the login's roles marks nothing, even under a parent the login sees.
	const currentHref = $derived(
		403 === page.status ? undefined : findCurrentHref(menu, page.url.pathname)
	);

	// A slot is current only on its own page, and none while the sheet is open: then, and on every
	// other page, «Más» is.
	const barSlots = $derived(
		getBarSlots(menu).map((slot) => ({
			...slot,
			isCurrent: !isMoreOpen && slot.href === currentHref
		}))
	);
	const barItems = $derived([
		...barSlots,
		{
			label: 'Más',
			icon: 'more' as const,
			onclick: openMore,
			isCurrent: !barSlots.some(({ isCurrent }) => isCurrent)
		}
	]);

	let sheetParentLabel = $state<string>();
	let isParentListOpen = $state(false);
	const sheetTitle = $derived((isParentListOpen && sheetParentLabel) || 'Más');

	// The sheet opens on the current parent's list, or on the first list.
	function openMore() {
		const parent = findSheetParent(menu, currentHref);
		sheetParentLabel = parent?.label;
		isParentListOpen = undefined !== parent;
		isMoreOpen = true;
	}
</script>

<!-- Both navigations are in the page; the width decides which one shows. -->
<div class="shell">
	<div class="shell__sidebar">
		<Sidebar {menu} {currentHref} username={data.username ?? ''} />
	</div>
	<div class="shell__screen">{@render children()}</div>
	<div class="shell__bar"><BottomNav items={barItems} /></div>
</div>

<BottomSheet bind:open={isMoreOpen} title={sheetTitle}>
	<MenuList {menu} {currentHref} bind:parentLabel={sheetParentLabel} bind:isParentListOpen>
		{#snippet session()}
			{#if data.username}<p class="meta">Sesión: <b>{data.username}</b></p>{/if}
			<LogoutButton>
				{#snippet trigger(open)}
					<Button type="button" variant="secondary" size="sm" inline onclick={open}>
						<Icon name="exit" />Cerrar sesión
					</Button>
				{/snippet}
			</LogoutButton>
		{/snippet}
	</MenuList>
</BottomSheet>

<style>
	.shell {
		display: grid;
		grid-template:
			'screen' 1fr
			'bar' auto
			/ 1fr;
		min-height: 100dvh;
	}

	.shell__screen {
		grid-area: screen;

		/* A wide child (a chip row, a table) scrolls inside the screen instead of widening it. */
		min-width: 0;
		min-height: 0;
	}

	/* The page scrolls as a whole, so the bottom bar sticks to the viewport's edge to stay in view. */
	.shell__bar {
		position: sticky;
		bottom: 0;
		grid-area: bar;
	}

	.shell__sidebar {
		display: none;
	}

	@container (width >= 1024px) {
		.shell {
			grid-template: 'sidebar screen' 1fr / auto 1fr;
		}

		.shell__sidebar {
			display: block;
			grid-area: sidebar;
			min-height: 0;
		}

		.shell__bar {
			display: none;
		}
	}
</style>
