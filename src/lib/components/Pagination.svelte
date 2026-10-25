<script lang="ts">
	import { getPageNumbers } from '$lib/navigation';

	// Links, not buttons: each page is a URL, so a page can be reloaded or shared. `href` builds a
	// page's URL with the rest of the query kept. Nothing renders when everything fits on one page.
	interface Props {
		current: number;
		count: number;
		href: (pageNumber: number) => string;
	}

	let { current, count, href }: Props = $props();

	const pageNumbers = $derived(getPageNumbers(current, count));
</script>

{#snippet step(label: string, target: number, isAvailable: boolean)}
	{#if isAvailable}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller's href keeps the current route -->
		<a class="pagination__step" href={href(target)}>{label}</a>
	{:else}
		<span class="pagination__step pagination__step--disabled" aria-disabled="true">{label}</span>
	{/if}
{/snippet}

{#if 1 < count}
	<nav class="pagination" aria-label="Páginas">
		{@render step('‹ Anterior', current - 1, 1 < current)}
		{#each pageNumbers as pageNumber, index (pageNumber ?? `gap-${index}`)}
			{#if null === pageNumber}
				<span class="pagination__gap" aria-hidden="true">…</span>
			{:else if pageNumber === current}
				<span class="pagination__item pagination__item--current" aria-current="page"
					>{pageNumber}</span
				>
			{:else}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller's href keeps the current route -->
				<a class="pagination__item" href={href(pageNumber)} aria-label="Página {pageNumber}"
					>{pageNumber}</a
				>
			{/if}
		{/each}
		{@render step('Siguiente ›', current + 1, current < count)}
	</nav>
{/if}

<style>
	.pagination {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		justify-content: center;
	}

	.pagination__item,
	.pagination__step,
	.pagination__gap {
		box-sizing: border-box;
		display: inline-grid;
		place-items: center;
		min-width: 44px;
		height: 44px;
		font: var(--weight-regular) var(--text-sm) / 1.2 var(--font-sans);
		font-variant-numeric: tabular-nums;
		color: var(--text-body);
		text-decoration: none;
	}

	.pagination__item,
	.pagination__step {
		padding: 0 var(--space-5);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-chip);
	}

	/* Selected is ink with white text, never yellow, as a chip. */
	.pagination__item--current {
		font-weight: var(--weight-semibold);
		color: var(--neutral-0);
		background: var(--neutral-800);
		border-color: var(--neutral-800);
	}

	.pagination__step--disabled {
		color: var(--text-disabled);
	}

	.pagination__gap {
		min-width: auto;
		color: var(--text-secondary);
	}

	@media (hover: hover) {
		a.pagination__item:hover,
		a.pagination__step:hover {
			border-color: var(--neutral-400);
		}
	}
</style>
