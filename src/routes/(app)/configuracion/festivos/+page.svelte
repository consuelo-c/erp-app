<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Select from '$lib/components/Select.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { addDays, formatLongDay, getTodaysDate } from '$lib/datetime';
	import { ADMIN_SETTINGS_TABS, SETTINGS_TABS } from '$lib/navigation';
	import type { Holiday } from '$lib/server/services/settings';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The dates on or before the freeze line were paid in a settlement: read-only here.
	const isClosed = (holiday: Holiday) =>
		null !== data.freezeLine && holiday.date <= data.freezeLine;
	const closed = $derived(data.holidays.filter(isClosed));
	const savedOpen = $derived(data.holidays.filter((holiday) => !isClosed(holiday)));
	// The list being edited: what's saved, again after every save.
	let open = $derived(savedOpen);
	const hasUnsavedList = $derived(JSON.stringify(open) !== JSON.stringify(savedOpen));
	const firstOpenDate = $derived(
		null === data.freezeLine ? undefined : addDays(data.freezeLine, 1)
	);

	// One year on screen at a time, this one by default.
	const yearOf = (date: string) => date.slice(0, 4);
	let year = $state(yearOf(getTodaysDate()));
	const years = $derived(
		[...new Set([year, ...[...closed, ...open].map((holiday) => yearOf(holiday.date))])].sort()
	);
	const shownClosed = $derived(closed.filter((holiday) => year === yearOf(holiday.date)));
	const shownOpen = $derived(open.filter((holiday) => year === yearOf(holiday.date)));

	let listInput: HTMLInputElement;
	let newDate = $state('');
	let newLabel = $state('');
	let addErrors = $state<HolidayErrors>({});

	// Correcting and removing an open date change the list, saved with «Guardar festivos».
	let correcting = $state<Holiday | null>(null);
	let isCorrectionOpen = $state(false);
	let correctedDate = $state('');
	let correctedLabel = $state('');
	let correctionErrors = $state<HolidayErrors>({});
	let removing = $state<Holiday | null>(null);
	let isRemovalOpen = $state(false);

	let expanded = $state<string | null>(null);
	let editing = $state<Holiday | null>(null);
	let isOverrideOpen = $state(false);
	let reason = $state('');

	type HolidayErrors = { date?: string; label?: string };

	const formatDay = (date: string) => formatLongDay(date).toLowerCase();
	const byDate = (first: Holiday, second: Holiday) => first.date.localeCompare(second.date);

	// Adding or removing a row types nothing: the guard has to be told the list changed.
	function markUnsaved() {
		listInput.dispatchEvent(new Event('input', { bubbles: true }));
	}

	// `replacing` is the row being corrected: its own date isn't a repeat.
	function findDateError(date: string, replacing?: Holiday): string | undefined {
		if ('' === date) {
			return 'Escoge la fecha del festivo.';
		}
		if (undefined !== firstOpenDate && date < firstOpenDate) {
			return `El ${formatDay(date)} está en una nómina pagada.`;
		}
		const repeated = [...closed, ...open].find(
			(holiday) => date === holiday.date && replacing !== holiday
		);
		if (undefined !== repeated) {
			return `Esta fecha ya está en la lista: ${formatDay(repeated.date)} · ${repeated.label}.`;
		}
		return undefined;
	}

	function validate(date: string, label: string, replacing?: Holiday): HolidayErrors {
		return {
			date: findDateError(date, replacing),
			label: '' === label.trim() ? 'Escribe el nombre del festivo.' : undefined
		};
	}

	function hasErrors(errors: HolidayErrors): boolean {
		return undefined !== errors.date || undefined !== errors.label;
	}

	// The list jumps to the year of the date just placed, so it doesn't vanish from view.
	function replaceList(holidays: Holiday[], shownDate: string) {
		open = holidays.sort(byDate);
		year = yearOf(shownDate);
		markUnsaved();
	}

	function addHoliday(event: SubmitEvent) {
		event.preventDefault();
		addErrors = validate(newDate, newLabel);
		if (hasErrors(addErrors)) {
			return;
		}
		replaceList([...open, { date: newDate, label: newLabel.trim() }], newDate);
		newDate = '';
		newLabel = '';
	}

	function startCorrection(holiday: Holiday) {
		correcting = holiday;
		correctedDate = holiday.date;
		correctedLabel = holiday.label;
		correctionErrors = {};
		isCorrectionOpen = true;
	}

	function applyCorrection(event: SubmitEvent) {
		event.preventDefault();
		correctionErrors = validate(correctedDate, correctedLabel, correcting ?? undefined);
		if (hasErrors(correctionErrors)) {
			return;
		}
		const corrected = { date: correctedDate, label: correctedLabel.trim() };
		replaceList(
			open.map((holiday) => (correcting === holiday ? corrected : holiday)),
			correctedDate
		);
		isCorrectionOpen = false;
	}

	function startRemoval(holiday: Holiday) {
		removing = holiday;
		isRemovalOpen = true;
	}

	function confirmRemoval() {
		open = open.filter((candidate) => removing !== candidate);
		isRemovalOpen = false;
		markUnsaved();
	}

	function startOverride(holiday: Holiday) {
		editing = holiday;
		reason = '';
		isOverrideOpen = true;
	}

	// Saving stays on the screen; the reloaded list replaces the edited one.
	const keepValues: SubmitFunction = () => {
		return ({ update }) => update({ reset: false });
	};

	// The popup saves on its own and closes once saved; a refusal keeps it open with its message.
	const submitOverride: SubmitFunction = () => {
		return async ({ result, update }) => {
			if ('success' === result.type) {
				isOverrideOpen = false;
				expanded = null;
			}
			await update({ reset: false });
		};
	};
</script>

<svelte:head>
	<title>Festivos · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader
			><Tabs
				tabs={data.canManageLogins ? ADMIN_SETTINGS_TABS : SETTINGS_TABS}
				current="Festivos"
			/></ScreenHeader
		>
	{/snippet}

	<UnsavedChangesGuard form="holidays" />

	<div class="holidays__year">
		<Field label="Año" id="year">
			<Select id="year" bind:value={year}>
				{#each years as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</Select>
		</Field>
	</div>

	{#if form?.saved}
		<div class="holidays__notice">
			<Notice tone="success">Festivos guardados con éxito</Notice>
		</div>
	{/if}
	{#if data.freezeLine}
		<Notice tone="info">
			La nómina está cerrada hasta el {formatDay(data.freezeLine)}.
			{#if data.canOverrideFreeze}
				Para cambiar un festivo hasta ese día, ábrelo y toca «Modificar fecha cerrada».
			{:else}
				Los festivos hasta ese día son de solo lectura.
			{/if}
		</Notice>
	{/if}

	<div class="holidays__list">
		{#if shownClosed.length > 0}
			<details class="holidays__closed">
				<summary class="holidays__summary">
					<span>
						{shownClosed.length}
						{1 === shownClosed.length ? 'festivo cerrado' : 'festivos cerrados'}
					</span>
					<span class="holidays__chevron" aria-hidden="true">›</span>
				</summary>
				<ul class="holidays__rows">
					{#each shownClosed as holiday (holiday.date)}
						<li class="holidays__row holidays__row--closed">
							{#if data.canOverrideFreeze}
								<button
									class="holidays__toggle"
									type="button"
									aria-expanded={holiday.date === expanded}
									onclick={() => (expanded = holiday.date === expanded ? null : holiday.date)}
								>
									<span class="holidays__day">
										<span class="holidays__date">{formatLongDay(holiday.date)}</span>
										<span class="meta">{holiday.label}</span>
									</span>
									<span class="meta">Cerrado</span>
									<span class="holidays__chevron" aria-hidden="true">›</span>
								</button>
								{#if holiday.date === expanded}
									<div class="holidays__override">
										{#if hasUnsavedList}
											<p class="note">Guarda primero los cambios de la lista.</p>
										{:else}
											<p class="note">
												Está en una nómina pagada. Al modificarla se pide el motivo.
											</p>
										{/if}
										<Button
											type="button"
											variant="secondary"
											size="sm"
											inline
											disabled={hasUnsavedList}
											onclick={() => startOverride(holiday)}
										>
											Modificar fecha cerrada
										</Button>
									</div>
								{/if}
							{:else}
								<span class="holidays__day">
									<span class="holidays__date">{formatLongDay(holiday.date)}</span>
									<span class="meta">{holiday.label}</span>
								</span>
								<span class="meta">Cerrado</span>
							{/if}
						</li>
					{/each}
				</ul>
			</details>
		{/if}

		<ul class="holidays__rows">
			{#each shownOpen as holiday (holiday.date)}
				<li class="holidays__row">
					<span class="holidays__day">
						<span class="holidays__date holidays__date--open">{formatLongDay(holiday.date)}</span>
						<span class="meta">{holiday.label}</span>
					</span>
					<span class="holidays__actions">
						<IconButton
							icon="edit"
							label="Corregir {formatDay(holiday.date)}"
							onclick={() => startCorrection(holiday)}
						/>
						<IconButton
							icon="trash"
							label="Quitar {formatDay(holiday.date)}"
							onclick={() => startRemoval(holiday)}
						/>
					</span>
				</li>
			{:else}
				{#if 0 === shownClosed.length}
					<li class="holidays__row"><p class="note">No hay festivos en {year}.</p></li>
				{/if}
			{/each}
		</ul>
	</div>

	<h2 class="section-title holidays__group">Agregar festivo</h2>
	<form class="form-stack" novalidate onsubmit={addHoliday}>
		<Field label="Fecha" id="new-date" error={addErrors.date}>
			<Input
				id="new-date"
				type="date"
				min={firstOpenDate}
				bind:value={newDate}
				aria-invalid={undefined !== addErrors.date}
			/>
		</Field>
		<Field label="Nombre del festivo" id="new-label" error={addErrors.label}>
			<Input
				id="new-label"
				placeholder="Ej.: Día de la Raza"
				bind:value={newLabel}
				aria-invalid={undefined !== addErrors.label}
			/>
		</Field>
		<Button type="submit" variant="secondary" inline>+ Agregar a la lista</Button>
	</form>

	<form id="holidays" method="POST" action="?/guardar" use:enhance={keepValues}>
		<input bind:this={listInput} type="hidden" name="holidays" value={JSON.stringify(open)} />
		{#if form?.message}
			<div class="holidays__notice">
				<Notice tone="error">{form.message}</Notice>
			</div>
		{/if}
	</form>

	<div class="screen__action">
		<Button type="submit" form="holidays">Guardar festivos</Button>
	</div>
	<p class="note">Cada cambio queda registrado con tu usuario.</p>
</Screen>

{#if correcting}
	<Modal
		bind:open={isCorrectionOpen}
		title="Corregir festivo"
		body="El cambio queda en la lista; se guarda con «Guardar festivos»."
	>
		<form id="correction" class="form-stack" novalidate onsubmit={applyCorrection}>
			<Field label="Fecha" id="correction-date" error={correctionErrors.date}>
				<Input
					id="correction-date"
					type="date"
					min={firstOpenDate}
					bind:value={correctedDate}
					aria-invalid={undefined !== correctionErrors.date}
				/>
			</Field>
			<Field label="Nombre del festivo" id="correction-label" error={correctionErrors.label}>
				<Input
					id="correction-label"
					bind:value={correctedLabel}
					aria-invalid={undefined !== correctionErrors.label}
				/>
			</Field>
		</form>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isCorrectionOpen = false)}>
				Cancelar
			</Button>
			<Button type="submit" form="correction" size="md">Corregir</Button>
		{/snippet}
	</Modal>
{/if}

{#if removing}
	{@const holiday = `${formatLongDay(removing.date)} · ${removing.label}`}
	<Modal
		bind:open={isRemovalOpen}
		title="¿Quitar este festivo?"
		body="{holiday} sale de la lista al guardar los festivos."
	>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isRemovalOpen = false)}>
				Cancelar
			</Button>
			<Button type="button" size="md" onclick={confirmRemoval}>Quitar</Button>
		{/snippet}
	</Modal>
{/if}

{#if data.canOverrideFreeze && data.freezeLine && editing}
	{@const holiday = `${formatLongDay(editing.date)} · ${editing.label}`}
	<Modal
		bind:open={isOverrideOpen}
		title="Modificar fecha cerrada"
		body="{holiday} está en la nómina cerrada hasta el {formatDay(data.freezeLine)}."
	>
		<form
			id="override"
			class="form-stack"
			method="POST"
			action="?/modificar"
			use:enhance={submitOverride}
		>
			{#key editing}
				<input type="hidden" name="original" value={editing.date} />
				<Field label="Fecha" id="override-date">
					<Input id="override-date" name="date" type="date" value={editing.date} required />
				</Field>
				<Field label="Nombre del festivo" id="override-label">
					<Input id="override-label" name="label" value={editing.label} required />
				</Field>
			{/key}
			<Field
				label="Motivo del cambio"
				id="override-reason"
				hint="Queda en el historial de cambios, no en el festivo."
			>
				<textarea
					class="holidays__reason"
					id="override-reason"
					name="reason"
					rows="3"
					placeholder="Escribe por qué cambias esta fecha"
					required
					bind:value={reason}></textarea>
			</Field>
			<Button type="submit" name="remove" value="true" variant="secondary" size="sm" inline>
				Quitar festivo
			</Button>
			{#if form?.overrideMessage}
				<Notice tone="error">{form.overrideMessage}</Notice>
			{/if}
		</form>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isOverrideOpen = false)}>
				Cancelar
			</Button>
			<Button type="submit" form="override" size="md" disabled={'' === reason.trim()}>
				Guardar cambio
			</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	.holidays__year {
		max-width: 12rem;
		margin-bottom: var(--space-8);
	}

	.holidays__actions {
		display: flex;
		gap: var(--space-8);
		align-items: center;
		color: var(--text-secondary);
	}

	.holidays__notice {
		margin-block: var(--space-5);
	}

	.holidays__list {
		margin-top: var(--space-8);
	}

	.holidays__closed {
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.holidays__summary {
		display: flex;
		gap: var(--space-6);
		align-items: center;
		justify-content: space-between;
		min-height: var(--tap-min);
		font-weight: var(--weight-semibold);
		cursor: pointer;
		list-style: none;
	}

	.holidays__summary::-webkit-details-marker {
		display: none;
	}

	.holidays__chevron {
		transition: rotate 0.15s;
	}

	.holidays__toggle[aria-expanded='true'] .holidays__chevron {
		rotate: 90deg;
	}

	.holidays__closed[open] > .holidays__summary .holidays__chevron {
		rotate: 90deg;
	}

	.holidays__rows {
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.holidays__closed .holidays__rows {
		border-top: var(--border-w-hair) solid var(--border-default);
	}

	.holidays__row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-6);
		align-items: center;
		min-height: 56px;
		padding-block: var(--space-3);
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.holidays__row--closed {
		color: var(--text-secondary);
	}

	.holidays__toggle {
		display: flex;
		flex: 1;
		gap: var(--space-6);
		align-items: center;
		min-height: 48px;
		padding: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		background: none;
		border: 0;
	}

	.holidays__day {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.holidays__date--open {
		font-weight: var(--weight-semibold);
	}

	.holidays__override {
		flex-basis: 100%;
		padding-bottom: var(--space-4);
	}

	.holidays__override .note {
		margin: 0 0 var(--space-4);
	}

	.holidays__group {
		margin-top: var(--space-12);
	}

	.holidays__reason {
		box-sizing: border-box;
		width: 100%;
		padding: var(--space-6) var(--space-7);
		margin: 0;
		font: var(--type-input);
		color: var(--text-body);
		resize: vertical;
		outline: none;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-input);
	}

	.holidays__reason:focus-visible {
		border-color: var(--border-strong);
	}
</style>
