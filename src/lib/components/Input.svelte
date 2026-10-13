<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	// The error state is the native `aria-invalid="true"`.
	let { value = $bindable(), ...rest }: HTMLInputAttributes = $props();
</script>

<input {...rest} class="input" bind:value />

<style>
	.input {
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

	.input:focus-visible {
		border-color: var(--border-strong);
	}

	.input[aria-invalid='true'] {
		border-color: var(--error-fg);
	}

	/* The red border hides the focus border change, so focus gets its own ring. */
	.input[aria-invalid='true']:focus-visible {
		outline: var(--border-w-strong) solid var(--error-fg);
		outline-offset: var(--space-1);
	}
</style>
