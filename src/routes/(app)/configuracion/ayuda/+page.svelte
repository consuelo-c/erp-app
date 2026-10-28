<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatInteger } from '$lib/format';
	import { SETTINGS_TABS } from '$lib/navigation';
	import { HELP_MAX_LENGTH } from '$lib/settings';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// After a failed save it comes back with what was typed; after a save, with what's stored.
	let text = $derived(form?.text ?? data.text);

	// Saving stays on the editor: the read view at /ayuda is the preview.
	const keepValues: SubmitFunction = () => {
		return ({ update }) => update({ reset: false });
	};
</script>

<svelte:head>
	<title>Editar ayuda · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={SETTINGS_TABS} current="Ayuda" /></ScreenHeader>
	{/snippet}

	<UnsavedChangesGuard form="help" />

	<form id="help" class="help-editor" method="POST" use:enhance={keepValues}>
		<Field label="Texto de la ayuda" id="text" error={form?.message}>
			<textarea
				class="help-editor__text"
				id="text"
				name="text"
				spellcheck="false"
				placeholder="Escribe la ayuda. Cada pregunta empieza con ##"
				aria-invalid={undefined !== form?.message}
				bind:value={text}></textarea>
			<div class="help-editor__foot">
				<p class="help-editor__syntax">
					<span>Formato:</span><code>## Pregunta</code><code>**negrita**</code><code>- lista</code>
					<span>Enlace: <code>[texto](https://…)</code></span>
					<span>Imagen: <code>![descripción](https://…)</code></span>
				</p>
				<p
					class={[
						'help-editor__counter',
						HELP_MAX_LENGTH < text.length && 'help-editor__counter--over'
					]}
					aria-live="polite"
				>
					{formatInteger(text.length)} / {formatInteger(HELP_MAX_LENGTH)}
				</p>
			</div>
		</Field>
	</form>

	<div class="screen__action help-editor__action">
		{#if form?.saved}
			<Notice tone="success">
				✓ Guardado · <a class="help-editor__link" href={resolve('/ayuda')}>Ver en Ayuda</a>
			</Notice>
		{/if}
		<Button type="submit" form="help">Guardar</Button>
	</div>
</Screen>

<style>
	.help-editor {
		max-width: 760px;
	}

	.help-editor__text {
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

	.help-editor__text:focus-visible {
		border-color: var(--border-strong);
	}

	.help-editor__text[aria-invalid='true'] {
		border-color: var(--error-fg);
	}

	/* The syntax note left, the counter right; past the limit the counter turns red. */
	.help-editor__foot {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3) var(--space-8);
		align-items: baseline;
		justify-content: space-between;
		margin-top: var(--space-3);
	}

	.help-editor__syntax {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		align-items: baseline;
		margin: 0;
		font-size: var(--text-label);
		color: var(--text-secondary);
	}

	.help-editor__syntax code {
		padding: 1px 5px;
		font-family: var(--font-mono);
		font-size: var(--text-label);
		color: var(--text-body);
		background: var(--surface-subtle);
		border-radius: var(--radius-sm);
	}

	.help-editor__counter {
		margin: 0 0 0 auto;
		font-size: var(--text-label);
		font-weight: var(--weight-semibold);
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.help-editor__counter--over {
		color: var(--error-fg);
	}

	.help-editor__action {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		max-width: 760px;
	}

	.help-editor__link {
		font-weight: var(--weight-semibold);
	}

	@container (width >= 1024px) {
		.help-editor__text {
			height: 60vh;
		}

		.help-editor__action {
			flex-direction: row;
			gap: var(--space-8);
			align-items: center;
		}

		.help-editor__action > :global(.notice) {
			flex: 1;
			min-width: 0;
		}
	}
</style>
