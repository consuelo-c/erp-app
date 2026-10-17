<script lang="ts">
	import { resolve } from '$app/paths';
	import Card from '$lib/components/Card.svelte';
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
	import { PUNCH_LABELS } from '$lib/labels';
	import { HOURS_TABS } from '$lib/navigation';
	import type { Punch } from '$lib/server/services/timesheets';
	import type { PageProps } from './$types';

	// Read-only: no status, no approve button. One card per employee on a phone, one table from
	// 1024px; the phone's times are short, since its columns already say mañana or tarde.
	let { data }: PageProps = $props();

	const punches = Object.keys(PUNCH_LABELS) as Punch[];
	const currentWeek = $derived(getWeekStart(data.today));

	// The current week is the plain URL; there's no week after it.
	function weekHref(weekStart: string): string {
		const team = resolve('/(app)/horas/equipo');
		return weekStart === currentWeek ? team : `${team}?semana=${weekStart}`;
	}

	function show(time: string | null, format: (clockTime: string) => string): string {
		return null === time ? '—' : format(time);
	}
</script>

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
							<td class="team-table__employee" rowspan={member.days.length}>
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
