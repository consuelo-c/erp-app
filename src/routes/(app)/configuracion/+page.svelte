<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/Button.svelte';
	import ClockField from '$lib/components/ClockField.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { toDialTime } from '$lib/datetime';
	import { formatInteger } from '$lib/format';
	import { SETTING_MODULE_LABELS } from '$lib/labels';
	import { ADMIN_SETTINGS_TABS, SETTINGS_TABS } from '$lib/navigation';
	import type { SystemSettingKey } from '$lib/server/services/settings';
	import { getSettingInput, SETTINGS } from '$lib/settings';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const keys = $derived(Object.keys(data.settings) as SystemSettingKey[]);
	const modules = Object.entries(SETTING_MODULE_LABELS) as [
		keyof typeof SETTING_MODULE_LABELS,
		string
	][];

	// After a failed save the fields come back with what was typed.
	const typed = (name: string, saved: string) => String(form?.values?.[name] ?? saved);

	// A stored number as people type it: 1.750.905.
	function format(key: SystemSettingKey, stored: string) {
		return 'number' === getSettingInput(key) ? formatInteger(Number(stored)) : stored;
	}

	function dial(key: SystemSettingKey) {
		const saved = toDialTime(data.settings[key]);
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

<svelte:head>
	<title>Configuración · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader
			><Tabs
				tabs={data.canManageLogins ? ADMIN_SETTINGS_TABS : SETTINGS_TABS}
				current="Configuración"
			/></ScreenHeader
		>
	{/snippet}

	<UnsavedChangesGuard form="settings" />

	<form id="settings" method="POST" use:enhance={keepValues}>
		{#if form?.saved}
			<div class="settings__notice">
				<Notice tone="success">Configuración guardada con éxito</Notice>
			</div>
		{/if}
		<Notice tone="warning">
			⚠ Estos valores calculan toda la nómina. Un error aquí la desajusta: revisa cada cambio antes
			de guardar.
		</Notice>

		{#each modules as [module, title] (module)}
			<h2 class="section-title settings__group">{title}</h2>
			<div class="settings__fields">
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
									value={typed(key, format(key, data.settings[key]))}
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
</Screen>

<style>
	.settings__notice {
		margin-block: var(--space-5);
	}

	.settings__group {
		margin-top: var(--space-12);
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
