<script lang="ts">
	// Label and value rows naming what a login screen acts on; read-only.
	let { rows }: { rows: [label: string, value: string][] } = $props();
</script>

<dl class="facts">
	{#each rows as [label, value] (label)}
		<div class="facts__row">
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	{/each}
</dl>

<style>
	.facts {
		margin: 0 0 var(--field-gap);
	}

	.facts__row {
		display: flex;
		justify-content: space-between;
		padding: var(--space-4) 0;
	}

	.facts dt {
		color: var(--text-secondary);
	}

	.facts dd {
		margin: 0;
		font-weight: var(--weight-semibold);
	}
</style>
