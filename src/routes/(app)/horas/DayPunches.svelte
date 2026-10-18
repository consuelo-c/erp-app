<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import PunchTile from '$lib/components/PunchTile.svelte';
	import { formatClockTime, formatLongDay } from '$lib/datetime';
	import { PUNCH_LABELS } from '$lib/labels';
	import type { Punch, TimesheetDay } from '$lib/server/services/timesheets';
	import type { SubmitFunction } from '@sveltejs/kit';

	// A day's four tiles and the time dialog they open. The hour is always typed, never taken from the
	// clock: hour and minutes on the number pad, then a.m. or p.m. A new punch starts on the usual
	// schedule's time, also the fields' placeholder; a correction starts with the punch. A short
	// form inside a Modal: like the one-field ones, it doesn't mount UnsavedChangesGuard.
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
	const USUAL_TIMES: Record<Punch, string> = {
		morningIn: '08:00',
		morningOut: '12:00',
		afternoonIn: '14:00',
		afternoonOut: '17:00'
	};

	let selected = $state<Punch | null>(null);
	let hour = $state('');
	let minute = $state('');
	let period = $state<'am' | 'pm'>('am');

	const current = $derived(null === selected ? null : day.punches[selected]);
	const placeholder = $derived(null === selected ? null : toDial(USUAL_TIMES[selected]));
	const title = $derived(
		null === selected
			? ''
			: `${current ? 'Corregir' : 'Marcar'} ${PUNCH_LABELS[selected].toLowerCase()}`
	);
	const body = $derived(
		`${formatLongDay(day.workDate).toLowerCase()}${current ? ` · marcada a las ${formatClockTime(current)}` : ''}`
	);

	// `HH:MM` as the dialog shows it: 1 to 12, the minutes, and a.m. or p.m.
	function toDial(time: string) {
		const [hour24, minutes] = time.split(':').map(Number);
		return {
			hour: String(hour24 % 12 || 12),
			minute: String(minutes).padStart(2, '0'),
			period: hour24 < 12 ? ('am' as const) : ('pm' as const)
		};
	}

	function open(punch: Punch) {
		selected = punch;
		({ hour, minute, period } = toDial(day.punches[punch] ?? USUAL_TIMES[punch]));
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
			}
		};
	};
</script>

{#if employeeName}
	<p class="meta">{employeeName}</p>
{/if}
<h2 class="day-punches__date">{formatLongDay(day.workDate)}</h2>

{#if !day.isEmployed}
	<!-- No tiles: the service refuses any punch outside the employment. -->
	<p class="note">Ese día no hace parte de ningún período laboral.</p>
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

	<form id={formId} method="POST" action="?/marcar" use:enhance={closeOnSave} hidden>
		<input type="hidden" name="work_date" value={day.workDate} />
		<input type="hidden" name="punch" value={selected} />
		{#if undefined !== employeeId}
			<input type="hidden" name="employee_id" value={employeeId} />
		{/if}
	</form>

	<!-- Esc closes the dialog from inside Modal: the setter clears the tile's ink border too. -->
	<Modal bind:open={() => null !== selected, closeUnless} {title} {body}>
		{#if message}
			<Notice tone="error">{message}</Notice>
		{/if}
		<fieldset class="clock">
			<legend class="clock__legend">Hora</legend>
			<div class="clock__row">
				<Input
					form={formId}
					name="hour"
					inputmode="numeric"
					maxlength={2}
					autocomplete="off"
					aria-label="Hora"
					placeholder={placeholder?.hour}
					required
					bind:value={hour}
				/>
				<span class="clock__colon">:</span>
				<Input
					form={formId}
					name="minute"
					inputmode="numeric"
					maxlength={2}
					autocomplete="off"
					aria-label="Minutos"
					placeholder={placeholder?.minute}
					bind:value={minute}
				/>
				{#each ['am', 'pm'] as const as value (value)}
					<Chip
						type="radio"
						form={formId}
						name="period"
						{value}
						label={'am' === value ? 'a.m.' : 'p.m.'}
						checked={value === period}
						onchange={() => (period = value)}
					/>
				{/each}
			</div>
		</fieldset>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (selected = null)}>Cancelar</Button>
			<Button type="submit" form={formId} size="md">Guardar</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	.clock {
		min-width: 0;
		padding: 0;
		margin: 0;
		border: 0;
	}

	/* The same look as a Field's label. */
	.clock__legend {
		padding: 0;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	/* Two short number fields, then the a.m./p.m. chips. */
	.clock__row {
		display: grid;
		grid-template-columns: 4rem auto 4rem auto auto;
		gap: var(--space-3);
		align-items: center;
	}

	.clock__colon {
		font-weight: var(--weight-bold);
	}

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
