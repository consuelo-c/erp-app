<script lang="ts">
	import type { Snippet } from 'svelte';

	// `id` ties the label to the control rendered in `children`, which must carry the same id.
	interface Props {
		label: string;
		id: string;
		hint?: string;
		children: Snippet;
	}

	let { label, id, hint, children }: Props = $props();
</script>

<div class="field">
	<label class="field__label" for={id}>{label}</label>
	{@render children()}
	{#if hint}
		<p class="field__hint">{hint}</p>
	{/if}
</div>

<style>
	.field {
		flex: 1;
		min-width: 0;
	}

	.field__label {
		display: block;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	.field__hint {
		margin: var(--space-3) 0 0;
		font-size: var(--text-label);
		font-style: italic;
		color: var(--text-secondary);
	}
</style>
