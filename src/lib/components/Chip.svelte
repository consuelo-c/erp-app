<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	// A label around a native checkbox or radio, so a form posts the selection without JS. A radio's
	// `checked` isn't bound (a group binds across inputs): the caller sets it and listens to `onchange`.
	// `error` is the danger tone, Vetado's: red text and border, a red fill when on.
	type Props = HTMLInputAttributes & {
		label: string;
		type?: 'checkbox' | 'radio';
		tone?: 'error';
	};

	let { label, type = 'checkbox', tone, checked = $bindable(false), ...rest }: Props = $props();
</script>

<label class={['chip', tone && `chip--${tone}`]}>
	{#if 'radio' === type}
		<input {...rest} type="radio" {checked} />{label}
	{:else}
		<input {...rest} type="checkbox" bind:checked />{label}
	{/if}
</label>

<style>
	.chip {
		position: relative;
		box-sizing: border-box;
		display: inline-flex;
		flex: none;
		align-items: center;
		padding: var(--chip-pad-md);
		margin: 0;
		font: var(--weight-regular) var(--text-sm) / 1.2 var(--font-sans);
		color: var(--text-body);
		white-space: nowrap;
		cursor: pointer;
		user-select: none;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-chip);
	}

	/* Selected is ink with white text, never yellow. */
	.chip:has(input:checked) {
		font-weight: var(--weight-semibold);
		color: var(--neutral-0);
		background: var(--neutral-800);
		border-color: var(--neutral-800);
	}

	.chip--error {
		color: var(--error-fg);
		border-color: var(--error-fg);
	}

	.chip--error:has(input:checked) {
		background: var(--error-fg);
		border-color: var(--error-fg);
	}

	.chip:has(input:focus-visible) {
		outline: var(--border-w-strong) solid var(--border-strong);
		outline-offset: var(--space-1);
	}

	.chip input {
		position: absolute;
		pointer-events: none;
		opacity: 0;
	}
</style>
