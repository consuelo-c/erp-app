<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatInteger } from '$lib/format';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { Snippet } from 'svelte';

	// One Markdown setting's editor, the help's or the terms': a textarea, its syntax and counter,
	// and Guardar. `notice` is what shows next to Guardar, the page's «✓ Guardado».
	type Props = {
		id: string;
		label: string;
		placeholder: string;
		// The syntax note's first example: what `##` starts in this text.
		heading: string;
		maxLength: number;
		text: string;
		error: string | undefined;
		notice?: Snippet;
	};

	let { id, label, placeholder, heading, maxLength, text, error, notice }: Props = $props();

	// After a failed save it comes back with what was typed; after a save, with what's stored.
	let value = $derived(text);

	// Saving stays on the editor.
	const keepValues: SubmitFunction = () => {
		return ({ update }) => update({ reset: false });
	};
</script>

<UnsavedChangesGuard form={id} />

<form {id} class="markdown-editor" method="POST" use:enhance={keepValues}>
	<Field {label} id="text" {error}>
		<textarea
			class="markdown-editor__text"
			id="text"
			name="text"
			spellcheck="false"
			{placeholder}
			aria-invalid={undefined !== error}
			bind:value></textarea>
		<div class="markdown-editor__foot">
			<p class="markdown-editor__syntax">
				<span>Formato:</span><code>## {heading}</code><code>**negrita**</code><code>- lista</code>
				<span>Enlace: <code>[texto](https://…)</code></span>
				<span>Imagen: <code>![descripción](https://…)</code></span>
			</p>
			<p
				class={[
					'markdown-editor__counter',
					maxLength < value.length && 'markdown-editor__counter--over'
				]}
				aria-live="polite"
			>
				{formatInteger(value.length)} / {formatInteger(maxLength)}
			</p>
		</div>
	</Field>
</form>

<div class="screen__action markdown-editor__action">
	{@render notice?.()}
	<Button type="submit" form={id}>Guardar</Button>
</div>

<style>
	.markdown-editor__text {
		box-sizing: border-box;
		width: 100%;
		height: 440px;
		padding: var(--space-6) var(--space-7);
		margin: 0;
		font: var(--type-input);
		font-family: var(--font-mono);
		line-height: 1.55;
		color: var(--text-body);
		resize: vertical;
		outline: none;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-input);
	}

	.markdown-editor__text:focus-visible {
		border-color: var(--border-strong);
	}

	.markdown-editor__text[aria-invalid='true'] {
		border-color: var(--error-fg);
	}

	/* The syntax note left, the counter right; past the limit the counter turns red. */
	.markdown-editor__foot {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3) var(--space-8);
		align-items: baseline;
		justify-content: space-between;
		margin-top: var(--space-3);
	}

	.markdown-editor__syntax {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		align-items: baseline;
		margin: 0;
		font-size: var(--text-label);
		color: var(--text-secondary);
	}

	.markdown-editor__syntax code {
		padding: 1px 5px;
		font-family: var(--font-mono);
		font-size: var(--text-label);
		color: var(--text-body);
		background: var(--surface-subtle);
		border-radius: var(--radius-sm);
	}

	.markdown-editor__counter {
		margin: 0 0 0 auto;
		font-size: var(--text-label);
		font-weight: var(--weight-semibold);
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.markdown-editor__counter--over {
		color: var(--error-fg);
	}

	.markdown-editor__action {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	@container (width >= 1024px) {
		.markdown-editor__text {
			height: 60vh;
		}

		.markdown-editor__action {
			flex-direction: row;
			gap: var(--space-8);
			align-items: center;
		}

		.markdown-editor__action > :global(.notice) {
			flex: 1;
			min-width: 0;
		}
	}
</style>
