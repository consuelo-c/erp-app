<script lang="ts">
	interface TimelineItem {
		id: string | number;
		title: string;
		meta: string;
	}

	let { items }: { items: TimelineItem[] } = $props();
</script>

<ol class="timeline">
	{#each items as item (item.id)}
		<li>
			<div class="timeline__title">{item.title}</div>
			<div class="timeline__meta">{item.meta}</div>
		</li>
	{/each}
</ol>

<style>
	.timeline {
		padding: 0 0 0 var(--space-8);
		margin: 0 0 0 var(--space-3);
		list-style: none;
		border-left: var(--border-w-strong) solid var(--border-default);
	}

	.timeline > li + li {
		margin-top: var(--space-9);
	}

	.timeline__title {
		font-weight: var(--weight-bold);
	}

	.timeline__meta {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
</style>
