<script lang="ts">
	import type { Snippet } from 'svelte';
	import IconButton from './IconButton.svelte';

	// A native modal dialog anchored to the bottom. Unlike Modal, it holds no decision: tapping the
	// scrim closes it, as do the close button and Esc.
	interface Props {
		open?: boolean;
		title: string;
		children: Snippet;
	}

	let { open = $bindable(false), title, children }: Props = $props();

	const titleId = $props.id();

	function syncOpen(dialog: HTMLDialogElement) {
		if (open && !dialog.open) {
			dialog.showModal();
		}
		if (!open && dialog.open) {
			dialog.close();
		}
	}

	// A click on the dialog element itself, not its content, is a click on the scrim.
	function closeOnScrim(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			open = false;
		}
	}
</script>

<dialog
	class="bottom-sheet"
	aria-labelledby={titleId}
	{@attach syncOpen}
	onclose={() => (open = false)}
	onclick={closeOnScrim}
>
	<div class="bottom-sheet__head">
		<h2 class="bottom-sheet__title" id={titleId}>{title}</h2>
		<IconButton icon="close" label="Cerrar" onclick={() => (open = false)} />
	</div>
	{@render children()}
</dialog>

<style>
	.bottom-sheet {
		box-sizing: border-box;
		width: 100%;
		max-width: 100%;
		padding: var(--space-10) var(--space-10) 30px;
		margin: auto 0 0;
		color: var(--text-body);
		background: var(--surface-card);
		border: 0;
		border-radius: var(--radius-dialog) var(--radius-dialog) 0 0;
	}

	.bottom-sheet::backdrop {
		background: var(--scrim);
	}

	.bottom-sheet__head {
		display: flex;
		gap: var(--space-6);
		align-items: center;
		margin-bottom: var(--space-3);
	}

	.bottom-sheet__title {
		flex: 1;
		margin: 0;
		font: var(--type-screen-title);
	}
</style>
