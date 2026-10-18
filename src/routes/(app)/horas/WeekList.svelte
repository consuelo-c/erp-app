<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { formatDayRange, formatShortDay } from '$lib/datetime';
	import { formatHours } from '$lib/format';
	import type { TimesheetDay } from '$lib/server/services/timesheets';

	// Día | Horas | ›: tapping a day up to today puts its four punches on top of the screen; the days
	// still to come don't open, nor do the ones outside the employment, which are muted but keep the
	// hours punched before the period changed, nor the ones a paid settlement locked. The day on top
	// is marked.
	interface Props {
		days: TimesheetDay[];
		today: string;
		selectedDate: string;
		dayHref: (workDate: string) => string;
	}

	let { days, today, selectedDate, dayHref }: Props = $props();

	function opens(day: TimesheetDay): boolean {
		return !day.isFuture && day.isEmployed && null === day.paidPeriod;
	}

	function hasPunches(day: TimesheetDay): boolean {
		return Object.values(day.punches).some((time) => null !== time);
	}
</script>

<table class="table">
	<thead>
		<tr
			><th>Día</th><th class="num">Horas</th><th><span class="visually-hidden">Abrir</span></th></tr
		>
	</thead>
	<tbody>
		{#each days as day (day.workDate)}
			<tr
				class={[
					opens(day) && 'table__row--link',
					!day.isEmployed && 'table__row--muted',
					null !== day.paidPeriod && 'table__row--locked',
					selectedDate === day.workDate && 'table__row--selected'
				]}
			>
				<td>
					{#if !opens(day)}
						{formatShortDay(day.workDate)}
					{:else}
						<!-- eslint-disable svelte/no-navigation-without-resolve -- dayHref builds it with resolve() -->
						<a
							class="table__link"
							href={dayHref(day.workDate)}
							aria-current={selectedDate === day.workDate ? 'date' : undefined}
							>{formatShortDay(day.workDate)}</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}
					{#if today === day.workDate}
						<div class="meta">Hoy</div>
					{:else if opens(day) && !hasPunches(day)}
						<div class="meta">Sin marcas</div>
					{/if}
					{#if !day.isEmployed}
						<div class="meta">Sin período laboral</div>
					{/if}
					{#if day.paidPeriod}
						<div class="meta">
							Pagado en la nómina del {formatDayRange(day.paidPeriod.start, day.paidPeriod.end)}
						</div>
					{/if}
				</td>
				{#if hasPunches(day)}
					<td class="num"><b>{formatHours(day.workedMinutes)}</b></td>
					<td class="num">{opens(day) ? '›' : ''}</td>
				{:else if opens(day)}
					<td class="num table__cell--missing"><Icon name="edit" size="sm" /></td>
					<td class="num">›</td>
				{:else}
					<td class="num">—</td>
					<td></td>
				{/if}
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.table {
		width: 100%;
		font-size: var(--text-md);
		border-collapse: collapse;
	}

	.table th {
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-label);
		font-weight: var(--weight-bold);
		color: var(--text-secondary);
		text-align: left;
		border-bottom: var(--border-w-strong) solid var(--border-strong);
	}

	.table td {
		padding: var(--space-4);
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	/* The day's link covers its whole row: one tap target per day. */
	.table__row--link {
		position: relative;
	}

	.table__row--muted {
		color: var(--text-secondary);
	}

	/* A day covered by a paid settlement: read-only. */
	.table__row--locked td {
		color: var(--text-disabled);
		background: var(--surface-subtle);
	}

	.table__row--locked .meta {
		color: var(--text-disabled);
	}

	.table__row--selected {
		font-weight: var(--weight-bold);
		background: var(--surface-subtle);
	}

	.table__link {
		color: inherit;
		text-decoration: none;
	}

	.table__link::after {
		position: absolute;
		inset: 0;
		content: '';
	}

	.table__cell--missing {
		color: var(--warning-fg);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		white-space: nowrap;
		clip-path: inset(50%);
	}
</style>
