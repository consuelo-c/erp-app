<script lang="ts">
	import { resolve } from '$app/paths';
	import Card from '$lib/components/Card.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import WeekPicker from '$lib/components/WeekPicker.svelte';
	import {
		addDays,
		formatClockTime,
		formatShortClockTime,
		formatWeekday,
		formatWeekRange,
		getWeekStart
	} from '$lib/datetime';
	import { formatHours } from '$lib/format';
	import { PUNCH_LABELS } from '$lib/labels';
	import { HOURS_TABS } from '$lib/navigation';
	import type { Punch, TeamMember } from '$lib/server/services/timesheets';
	import type { PageProps } from './$types';

	// Read-only: no status, no approve button. One card per employee on a phone, one table from
	// 1024px; the phone's times are short, since its columns already say mañana or tarde.
	let { data }: PageProps = $props();

	const punches = Object.keys(PUNCH_LABELS) as Punch[];
	const currentWeek = $derived(getWeekStart(data.today));
	const OVERTIME_HINT = 'Horas extra diurnas + nocturnas + dominicales + dominicales nocturnas';

	// The current week is the plain URL; there's no week after it.
	function weekHref(weekStart: string): string {
		const team = resolve('/(app)/horas/equipo');
		return weekStart === currentWeek ? team : `${team}?semana=${weekStart}`;
	}

	function show(time: string | null, format: (clockTime: string) => string): string {
		return null === time ? '—' : format(time);
	}
</script>

<!-- Five cells, like a day's row in either table: the label spans the day and three punches. -->
{#snippet totals(member: TeamMember)}
	<tr>
		<td colspan="4"><b>Horas laborales regulares</b></td>
		<td class="num"><b>{formatHours(member.regularMinutes)}</b></td>
	</tr>
	<tr>
		<td colspan="4">
			<b>Horas extras</b>
			<!-- Hover on a mouse, tap on a phone: a tap leaves the button hovered or focused. -->
			<button type="button" class="hint" aria-label={OVERTIME_HINT}>
				<Icon name="info" size="sm" />
				<span class="hint__text" aria-hidden="true">{OVERTIME_HINT}</span>
			</button>
		</td>
		<td class="num"><b>{formatHours(member.overtimeMinutes)}</b></td>
	</tr>
{/snippet}

<svelte:head>
	<title>Horas del equipo · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={HOURS_TABS} current="Equipo" /></ScreenHeader>
	{/snippet}

	<WeekPicker
		title="Semana"
		range={formatWeekRange(data.weekStart)}
		previousHref={weekHref(addDays(data.weekStart, -7))}
		nextHref={data.weekStart < currentWeek ? weekHref(addDays(data.weekStart, 7)) : null}
	/>

	{#if 0 === data.team.length}
		<Notice tone="info">Nadie trabajaba en la empresa esa semana</Notice>
	{/if}

	<div class="team-cards">
		{#each data.team as member (member.employeeId)}
			<Card>
				{#snippet head()}
					<b>{member.fullName}</b><span class="meta">{member.position}</span>
				{/snippet}
				<table class="table">
					<thead>
						<tr>
							<th rowspan="2">Día</th>
							<th class="num" colspan="2">Mañana</th>
							<th class="num" colspan="2">Tarde</th>
						</tr>
						<tr>
							<th class="num">Inicio</th>
							<th class="num">Fin</th>
							<th class="num">Inicio</th>
							<th class="num">Fin</th>
						</tr>
					</thead>
					<tbody>
						{#each member.days as day (day.workDate)}
							<tr>
								<td>{formatWeekday(day.workDate)}</td>
								{#each punches as punch (punch)}
									<td class="num">{show(day.punches[punch], formatShortClockTime)}</td>
								{/each}
							</tr>
						{/each}
						{@render totals(member)}
					</tbody>
				</table>
			</Card>
		{/each}
	</div>

	<table class="table team-table">
		<thead>
			<tr>
				<th>Empleado</th>
				<th>Día</th>
				{#each punches as punch (punch)}
					<th class="num">{PUNCH_LABELS[punch]}</th>
				{/each}
			</tr>
		</thead>
		{#each data.team as member (member.employeeId)}
			<tbody>
				{#each member.days as day, i (day.workDate)}
					<tr>
						{#if 0 === i}
							<td class="team-table__employee" rowspan={member.days.length + 2}>
								<b>{member.fullName}</b>
								<div class="meta">{member.position}</div>
							</td>
						{/if}
						<td>{formatWeekday(day.workDate)}</td>
						{#each punches as punch (punch)}
							<td class="num">{show(day.punches[punch], formatClockTime)}</td>
						{/each}
					</tr>
				{/each}
				{@render totals(member)}
			</tbody>
		{/each}
	</table>
</Screen>

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

	.table thead tr:first-child th[colspan] {
		border-bottom: 0;
	}

	.table td {
		padding: var(--space-4);
		white-space: nowrap;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	/* One <tbody> per employee: an ink rule between them. */
	.table tbody + tbody {
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.team-table {
		display: none;
	}

	.hint {
		position: relative;
		padding: var(--space-2);
		color: var(--text-secondary);
		cursor: help;
		background: none;
		border: 0;
	}

	.hint__text {
		position: absolute;
		bottom: 100%;
		left: 50%;
		z-index: var(--z-modal);
		display: none;
		width: max-content;
		max-width: 240px;
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-sm);
		color: var(--neutral-0);
		text-align: left;
		white-space: normal;
		background: var(--neutral-900);
		border-radius: var(--radius-sm);
		translate: -50% 0;
	}

	.hint:hover .hint__text,
	.hint:focus .hint__text {
		display: block;
	}

	.team-table__employee {
		vertical-align: top;
	}

	@container (width >= 1024px) {
		.team-cards {
			display: none;
		}

		.team-table {
			display: table;
		}
	}
</style>
