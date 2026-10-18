<script lang="ts">
	import type { Snippet } from 'svelte';

	// `id` ties the label to the control rendered in `children`, which must carry the same id and,
	// with an `error`, `aria-invalid`. The error takes the hint's place.
	interface Props {
		label: string;
		id: string;
		hint?: string;
		error?: string;
		children: Snippet;
	}

	let { label, id, hint, error, children }: Props = $props();
</script>

<div class="field">
	<label class="field__label" for={id}>{label}</label>
	{@render children()}
	{#if error}
		<p class="field__error">{error}</p>
	{:else if hint}
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

	.field__error {
		margin: var(--space-3) 0 0;
		font-size: var(--text-label);
		font-weight: var(--weight-semibold);
		color: var(--error-fg);
	}
</style>
