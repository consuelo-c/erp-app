<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/Button.svelte';
	import ClockField from '$lib/components/ClockField.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import PunchTile from '$lib/components/PunchTile.svelte';
	import { formatClockTime, formatDayRange, formatLongDay, toDialTime } from '$lib/datetime';
	import { PUNCH_LABELS } from '$lib/labels';
	import type { Punch, TimesheetDay } from '$lib/server/services/timesheets';
	import type { SubmitFunction } from '@sveltejs/kit';

	// A day's four tiles and the time dialog they open. The hour is always typed, never taken from the
	// clock: hour and minutes on the number pad, then a.m. or p.m. A new punch starts on the usual
	// schedule's time, also the fields' placeholder; a correction starts with the punch. A short
	// form inside a Modal: like the one-field ones, it doesn't mount UnsavedChangesGuard. A day
	// punched by mistake is cleared whole, after asking.
	interface Props {
		day: TimesheetDay;
		isToday: boolean;
		// Above the date on one's own hours; left out where the employee is already on screen.
		employeeName?: string;
		// The selector's employee, posted with the punch; left out on one's own hours.
		employeeId?: number;
		// The last save's refusal, shown in the dialog.
		message?: string;
	}

	let { day, isToday, employeeName, employeeId, message }: Props = $props();

	const punches = Object.keys(PUNCH_LABELS) as Punch[];
	const formId = $props.id();
	const clearFormId = `${formId}-clear`;
	const USUAL_TIMES: Record<Punch, string> = {
		morningIn: '08:00',
		morningOut: '12:00',
		afternoonIn: '14:00',
		afternoonOut: '17:00'
	};

	let selected = $state<Punch | null>(null);
	let isClearing = $state(false);
	let hour = $state('');
	let minute = $state('');
	let period = $state<'am' | 'pm'>('am');

	const hasPunches = $derived(Object.values(day.punches).some((time) => null !== time));
	const current = $derived(null === selected ? null : day.punches[selected]);
	const placeholder = $derived(null === selected ? null : toDialTime(USUAL_TIMES[selected]));
	const title = $derived(
		null === selected
			? ''
			: `${current ? 'Corregir' : 'Marcar'} ${PUNCH_LABELS[selected].toLowerCase()}`
	);
	const body = $derived(
		`${formatLongDay(day.workDate).toLowerCase()}${current ? ` · marcada a las ${formatClockTime(current)}` : ''}`
	);

	function open(punch: Punch) {
		selected = punch;
		({ hour, minute, period } = toDialTime(day.punches[punch] ?? USUAL_TIMES[punch]));
	}

	function closeUnless(isOpen: boolean) {
		if (!isOpen) {
			selected = null;
		}
	}

	// The dialog closes once the punch is saved; a refusal keeps it open with the message. No form
	// reset: it would uncheck the a.m./p.m. radio, whose `checked` isn't bound, and `open` sets
	// every field anyway.
	const closeOnSave: SubmitFunction = () => {
		return async ({ result, update }) => {
			await update({ reset: false });
			if ('success' === result.type) {
				selected = null;
				isClearing = false;
			}
		};
	};
</script>

{#if employeeName}
	<p class="meta">{employeeName}</p>
{/if}
<h2 class="day-punches__date">{formatLongDay(day.workDate)}</h2>

{#if !day.isEmployed}
	<!-- No tiles: the service refuses any punch outside the employment, or on a paid day. -->
	<p class="note">Ese día no hace parte de ningún período laboral.</p>
{:else if day.paidPeriod}
	<p class="note">
		Pagado en la nómina del {formatDayRange(day.paidPeriod.start, day.paidPeriod.end)}: ya no se
		puede cambiar.
	</p>
{:else}
	<div class="punch-grid">
		{#each punches as punch (punch)}
			{@const value = day.punches[punch]}
			<PunchTile
				label={PUNCH_LABELS[punch]}
				time={value && formatClockTime(value)}
				pendingText={isToday ? 'Marcar' : 'Agregar'}
				aria-expanded={punch === selected}
				onclick={() => open(punch)}
			/>
		{/each}
	</div>
	<p class="note">
		{isToday
			? 'Toca «Marcar» para ingresar la hora, o una marca hecha para corregirla.'
			: 'Toca una marca para agregar la hora.'}
	</p>

	{#if hasPunches}
		<Button type="button" variant="secondary" size="sm" inline onclick={() => (isClearing = true)}>
			Borrar marcas del día
		</Button>
	{/if}

	<form id={formId} method="POST" action="?/marcar" use:enhance={closeOnSave} hidden>
		<input type="hidden" name="work_date" value={day.workDate} />
		<input type="hidden" name="punch" value={selected} />
		{#if undefined !== employeeId}
			<input type="hidden" name="employee_id" value={employeeId} />
		{/if}
	</form>

	<form id={clearFormId} method="POST" action="?/borrar" use:enhance={closeOnSave} hidden>
		<input type="hidden" name="work_date" value={day.workDate} />
		{#if undefined !== employeeId}
			<input type="hidden" name="employee_id" value={employeeId} />
		{/if}
	</form>

	<Modal
		bind:open={isClearing}
		title="¿Borrar las marcas del {formatLongDay(day.workDate).toLowerCase()}?"
		body="Las cuatro marcas quedan vacías. Puedes volver a marcarlas."
	>
		{#if message}
			<Notice tone="error">{message}</Notice>
		{/if}
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isClearing = false)}
				>Cancelar</Button
			>
			<Button type="submit" form={clearFormId} size="md">Borrar</Button>
		{/snippet}
	</Modal>

	<!-- Esc closes the dialog from inside Modal: the setter clears the tile's ink border too. -->
	<Modal bind:open={() => null !== selected, closeUnless} {title} {body}>
		{#if message}
			<Notice tone="error">{message}</Notice>
		{/if}
		<ClockField legend="Hora" form={formId} {placeholder} bind:hour bind:minute bind:period />
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (selected = null)}>Cancelar</Button>
			<Button type="submit" form={formId} size="md">Guardar</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	.day-punches__date {
		margin: var(--space-1) 0 var(--space-7);
		font: var(--weight-bold) var(--text-2xl) / 1.25 var(--font-sans);
	}

	.punch-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--control-gap);
		margin-bottom: var(--space-4);
	}
</style>
