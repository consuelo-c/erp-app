<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import LogoutButton from '$lib/components/LogoutButton.svelte';
	import MenuList from '$lib/components/MenuList.svelte';
	import { BAR_SLOTS, DESTINATIONS, findDestination, HELP } from '$lib/navigation';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	let isMoreOpen = $state(false);

	// The sheet's rows are links: leaving the page closes it.
	afterNavigate(() => {
		isMoreOpen = false;
	});

	const current = $derived(findDestination(page.url.pathname));
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
			isCurrent: isMoreOpen || moreDestinations.some((destination) => destination === current)
		}
	]);

	const moreRows = $derived([
		...moreDestinations.map((destination) => ({
			...destination,
			isCurrent: destination === current
		})),
		HELP
	]);
</script>

<div class="shell">
	<div class="shell__screen">{@render children()}</div>
	<BottomNav items={barItems} />
</div>

<BottomSheet bind:open={isMoreOpen} title="Más">
	<MenuList rows={moreRows}>
		{#snippet session()}
			<p class="meta">Sesión: <b>{data.username}</b></p>
			<LogoutButton />
		{/snippet}
	</MenuList>
</BottomSheet>

<style>
	.shell {
		display: grid;
		grid-template-rows: 1fr auto;
		height: 100%;
	}

	.shell__screen {
		min-height: 0;
	}
</style>
