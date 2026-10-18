<script lang="ts">
	import Notice from '$lib/components/Notice.svelte';
	import WeekPicker from '$lib/components/WeekPicker.svelte';
	import { addDays, formatWeekRange, getWeekStart } from '$lib/datetime';
	import type { Hours } from '$lib/server/services/timesheets';
	import DayPunches from './DayPunches.svelte';
	import WeekList from './WeekList.svelte';

	// A day's punches on top and a week under them, for Mis horas and for Empleado. Tapping a day in
	// the week loads it on top (`?dia=`); the arrows change the week only (`?semana=`), and while the
	// day isn't in the week shown, its punches give way to a hint: punching a day you can't see in
	// the week is how hours land on the wrong day.
	interface Props {
		hours: Hours;
		today: string;
		// The screen's URL with these parameters added: Empleado keeps its `?empleado=` in every link.
		href: (query: { dia?: string; semana?: string }) => string;
		// One's own hours show the name above the date; Empleado posts the chosen employee instead.
		employeeName?: string;
		employeeId?: number;
		message?: string;
	}

	let { hours, today, href, employeeName, employeeId, message }: Props = $props();

	const currentWeek = $derived(getWeekStart(today));
	const weekStart = $derived(hours.week[0].workDate);
	const isDayInWeek = $derived(hours.week.some(({ workDate }) => hours.day.workDate === workDate));

	// Today and the current week are the plain URL; there's no week after the current one.
	function weekHref(start: string): string {
		return href(start === currentWeek ? {} : { semana: start });
	}

	function dayHref(workDate: string): string {
		return href(workDate === today ? {} : { dia: workDate });
	}
</script>

{#if isDayInWeek}
	<DayPunches
		day={hours.day}
		isToday={today === hours.day.workDate}
		{employeeName}
		{employeeId}
		{message}
	/>
{:else}
	{#if employeeName}
		<p class="meta">{employeeName}</p>
	{/if}
	<Notice tone="info">Toca un día de la semana para ver o corregir sus marcas.</Notice>
{/if}
<section class="week">
	<WeekPicker
		title="Semana"
		range={formatWeekRange(weekStart)}
		previousHref={weekHref(addDays(weekStart, -7))}
		nextHref={weekStart < currentWeek ? weekHref(addDays(weekStart, 7)) : null}
	/>
	<WeekList days={hours.week} {today} selectedDate={hours.day.workDate} {dayHref} />
</section>

<style>
	.week {
		margin-top: var(--section-gap);
	}
</style>
