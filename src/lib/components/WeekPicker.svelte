<script lang="ts">
	// The week lists' header: the title on the left, ‹ range › on the right. Each arrow is a link to
	// that week; `nextHref` is null on the current week, so it shows but doesn't go anywhere.
	interface Props {
		title: string;
		range: string;
		previousHref: string;
		nextHref: string | null;
	}

	let { title, range, previousHref, nextHref }: Props = $props();
</script>

<div class="week-picker">
	<h2 class="section-title">{title}</h2>
	<div class="week-picker__nav">
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href built with resolve() -->
		<a class="week-picker__arrow" href={previousHref} aria-label="Semana anterior">‹</a>
		<span class="week-picker__range">{range}</span>
		{#if nextHref}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes an href built with resolve() -->
			<a class="week-picker__arrow" href={nextHref} aria-label="Semana siguiente">›</a>
		{:else}
			<span class="week-picker__arrow" aria-label="Semana siguiente" aria-disabled="true">›</span>
		{/if}
	</div>
</div>

<style>
	.week-picker {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}

	.week-picker > .section-title {
		margin: 0;
	}

	.week-picker__nav {
		display: flex;
		align-items: center;
	}

	.week-picker__range {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		white-space: nowrap;
	}

	/* The icon-btn's 44px hit area around a text glyph. */
	.week-picker__arrow {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		font-size: var(--text-2xl);
		color: var(--text-body);
		text-decoration: none;
	}

	.week-picker__arrow[aria-disabled='true'] {
		color: var(--text-disabled);
	}
</style>
