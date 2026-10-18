<script lang="ts">
	import type { Snippet } from 'svelte';

	// Required for irreversible or session-ending actions. A native modal dialog: the scrim click
	// does nothing, so the user picks a button; Esc closes it like Cancel.
	interface Props {
		open?: boolean;
		title: string;
		// A snippet when part of the text needs emphasis.
		body: string | Snippet;
		children?: Snippet;
		actions: Snippet;
	}

	let { open = $bindable(false), title, body, children, actions }: Props = $props();

	const titleId = $props.id();

	function syncOpen(dialog: HTMLDialogElement) {
		if (open && !dialog.open) {
			dialog.showModal();
		}
		if (!open && dialog.open) {
			dialog.close();
		}
	}
</script>

<dialog class="modal" aria-labelledby={titleId} {@attach syncOpen} onclose={() => (open = false)}>
	<h2 class="modal__title" id={titleId}>{title}</h2>
	<p class="modal__body">
		{#if 'string' === typeof body}{body}{:else}{@render body()}{/if}
	</p>
	{#if children}
		<div class="modal__field">{@render children()}</div>
	{/if}
	<div class="modal__actions">{@render actions()}</div>
</dialog>

<style>
	.modal {
		box-sizing: border-box;
		width: calc(100% - 2 * var(--screen-pad-x));
		max-width: var(--dialog-max-w);
		max-height: 100%;
		padding: var(--space-11);
		margin: auto;
		overflow-y: auto;
		color: var(--text-body);
		background: var(--surface-card);
		border: var(--border-w-strong) solid var(--border-strong);
		border-radius: var(--radius-dialog);
		box-shadow: var(--shadow-dialog);
	}

	.modal::backdrop {
		background: var(--scrim);
	}

	.modal__title {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		margin: 0;
		font: var(--type-section-title);
	}

	.modal__body {
		margin: var(--space-4) 0 0;
		font: var(--type-body);
		text-wrap: pretty;
	}

	.modal__field {
		margin-top: var(--field-gap);
	}

	.modal__actions {
		display: flex;
		gap: var(--control-gap);
		margin-top: var(--section-gap);
	}

	/* The buttons come from the caller's `actions` snippet. */
	.modal__actions > :global(.btn) {
		flex: 1;
		min-height: var(--tap-min);
	}
</style>
