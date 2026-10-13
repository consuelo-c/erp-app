<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';

	let { value = $bindable(), children, ...rest }: HTMLSelectAttributes = $props();
</script>

<select {...rest} class="select" bind:value>
	{@render children?.()}
</select>

<style>
	.select {
		box-sizing: border-box;
		width: 100%;
		padding: var(--space-6) var(--space-7);
		margin: 0;
		font: var(--type-input);
		color: var(--text-body);
		outline: none;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-input);
	}

	.select:focus-visible {
		border-color: var(--border-strong);
	}
</style>
