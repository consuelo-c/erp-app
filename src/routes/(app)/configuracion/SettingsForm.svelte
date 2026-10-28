<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/Button.svelte';
	import ClockField from '$lib/components/ClockField.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { toDialTime } from '$lib/datetime';
	import { formatInteger } from '$lib/format';
	import { SETTING_MODULE_LABELS } from '$lib/labels';
	import type { SystemSettingKey, SystemSettings } from '$lib/server/services/settings';
	import { getSettingInput, SETTINGS } from '$lib/settings';
	import type { Snippet } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	// General's and Nómina's form: the keys the page loaded, grouped by module when there are several.
	interface Props {
		settings: Partial<SystemSettings>;
		form: {
			saved?: boolean;
			errors?: Partial<Record<SystemSettingKey, string>>;
			values?: Record<string, FormDataEntryValue>;
		} | null;
		/** Above the fields, under the saved notice. */
		children?: Snippet;
	}

	let { settings, form, children }: Props = $props();

	const keys = $derived(Object.keys(settings) as SystemSettingKey[]);
	const modules = $derived(
		(
			Object.entries(SETTING_MODULE_LABELS) as [keyof typeof SETTING_MODULE_LABELS, string][]
		).filter(([module]) => keys.some((key) => module === SETTINGS[key].module))
	);

	// After a failed save the fields come back with what was typed.
	const typed = (name: string, saved: string) => String(form?.values?.[name] ?? saved);

	// A stored number as people type it: 1.750.905.
	function format(key: SystemSettingKey, stored: string) {
		return 'number' === getSettingInput(key) ? formatInteger(Number(stored)) : stored;
	}

	function dial(key: SystemSettingKey) {
		const saved = toDialTime(settings[key] ?? '');
		return {
			hour: typed(`${key}.hour`, saved.hour),
			minute: typed(`${key}.minute`, saved.minute),
			period: typed(`${key}.period`, saved.period) as 'am' | 'pm',
			placeholder: toDialTime(SETTINGS[key].placeholder)
		};
	}

	// Saving stays on the screen: the fields keep what was typed until the reloaded values replace it.
	const keepValues: SubmitFunction = () => {
		return ({ update }) => update({ reset: false });
	};
</script>

<UnsavedChangesGuard form="settings" />

<form id="settings" class="settings" method="POST" use:enhance={keepValues}>
	{#if form?.saved}
		<div class="settings__notice">
			<Notice tone="success">Configuración guardada con éxito</Notice>
		</div>
	{/if}
	{@render children?.()}

	{#each modules as [module, title] (module)}
		{#if modules.length > 1}
			<h2 class="section-title settings__group">{title}</h2>
		{/if}
		<div class="settings__fields" class:settings__fields--untitled={1 === modules.length}>
			{#each keys.filter((key) => module === SETTINGS[key].module) as key (key)}
				{@const { label, unit } = SETTINGS[key]}
				{@const input = getSettingInput(key)}
				{@const error = form?.errors?.[key]}
				{#if 'clock' === input}
					<ClockField legend={label} prefix="{key}." {...dial(key)} {error} />
				{:else}
					<Field {label} id={key} {error}>
						<div class="settings__value">
							<Input
								id={key}
								name={key}
								value={typed(key, format(key, settings[key] ?? ''))}
								placeholder="Ej. {format(key, SETTINGS[key].placeholder)}"
								inputmode={'number' === input ? 'numeric' : undefined}
								aria-invalid={undefined !== error}
								required
							/>
							{#if unit}
								<span class="settings__unit">{unit}</span>
							{/if}
						</div>
					</Field>
				{/if}
			{/each}
		</div>
	{/each}

	{#if form?.errors}
		<div class="settings__notice">
			<Notice tone="error">Revisa los campos marcados en rojo antes de guardar.</Notice>
		</div>
	{/if}
</form>

<div class="screen__action">
	<Button type="submit" form="settings">Guardar configuración</Button>
</div>
<p class="note settings__note">Cada cambio queda registrado con tu usuario.</p>

<style>
	.settings__notice {
		margin-block: var(--space-5);
	}

	.settings__group,
	.settings__fields--untitled {
		margin-top: var(--space-12);
	}

	.settings > :first-child {
		margin-top: 0;
	}

	.settings__fields {
		display: flex;
		flex-direction: column;
		gap: var(--field-gap);
	}

	.settings__value {
		display: flex;
		gap: var(--space-4);
		align-items: center;
	}

	.settings__unit {
		flex: none;
		width: 3rem;
		color: var(--text-secondary);
	}

	@container (width >= 1024px) {
		.settings__note {
			text-align: right;
		}
	}
</style>
