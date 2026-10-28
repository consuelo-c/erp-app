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
	import { BAR_SLOTS, DESTINATIONS, findDestination, HELP } from '$lib/navigation';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	let isMoreOpen = $state(false);
	let isSidebarCollapsed = $state(false);

	// The sheet's rows are links: leaving the page closes it.
	afterNavigate(() => {
		isMoreOpen = false;
	});

	const current = $derived(findDestination(page.url.pathname));
	const isHelpCurrent = $derived(HELP.href === page.url.pathname);
	const barDestinations = DESTINATIONS.slice(0, BAR_SLOTS);
	const moreDestinations = DESTINATIONS.slice(BAR_SLOTS);

	// While the sheet is open, «Más» is the current slot.
	const barItems = $derived([
		...barDestinations.map((destination) => ({
			...destination,
			isCurrent: !isMoreOpen && destination === current
		})),
		{
			label: 'Más',
			icon: 'more' as const,
			onclick: () => (isMoreOpen = true),
			isCurrent:
				isMoreOpen ||
				isHelpCurrent ||
				moreDestinations.some((destination) => destination === current)
		}
	]);

	const moreRows = $derived([
		...moreDestinations.map((destination) => ({
			...destination,
			isCurrent: destination === current
		})),
		{ ...HELP, isCurrent: isHelpCurrent }
	]);

	const sidebarItems = $derived(
		DESTINATIONS.map((destination) => ({ ...destination, isCurrent: destination === current }))
	);
</script>

<!-- Both navigations are in the page; the width decides which one shows. -->
<div class="shell">
	<div class="shell__sidebar">
		<Sidebar
			items={sidebarItems}
			footItems={[{ ...HELP, isCurrent: isHelpCurrent }]}
			username={data.username ?? ''}
			bind:isCollapsed={isSidebarCollapsed}
		/>
	</div>
	<div class="shell__screen">{@render children()}</div>
	<div class="shell__bar"><BottomNav items={barItems} /></div>
</div>

<BottomSheet bind:open={isMoreOpen} title="Más">
	<MenuList rows={moreRows}>
		{#snippet session()}
			{#if data.username}<p class="meta">Sesión: <b>{data.username}</b></p>{/if}
			<LogoutButton>
				{#snippet trigger(open)}
					<Button type="button" variant="secondary" size="sm" inline onclick={open}>
						<Icon name="exit" size="sm" />Cerrar sesión
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
		height: 100%;
	}

	.shell__screen {
		grid-area: screen;

		/* A wide child (a chip row, a table) scrolls inside the screen instead of widening it. */
		min-width: 0;
		min-height: 0;
	}

	.shell__bar {
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
