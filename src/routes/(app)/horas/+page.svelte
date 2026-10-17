<script lang="ts">
	import { resolve } from '$app/paths';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import WeekPicker from '$lib/components/WeekPicker.svelte';
	import { addDays, formatWeekRange, getWeekStart } from '$lib/datetime';
	import DayPunches from './DayPunches.svelte';
	import WeekList from './WeekList.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const currentWeek = $derived(getWeekStart(data.today));

	// Today and the current week are the plain URL; there's no week after the current one. Another
	// day's link needs no `?semana=`: its week comes with it.
	function weekHref(weekStart: string): string {
		const hours = resolve('/(app)/horas');
		return weekStart === currentWeek ? hours : `${hours}?semana=${weekStart}`;
	}

	function dayHref(workDate: string): string {
		const hours = resolve('/(app)/horas');
		return workDate === data.today ? hours : `${hours}?dia=${workDate}`;
	}
</script>

<svelte:head>
	<title>Mis horas · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Mis horas" />
	{/snippet}

	{#if null === data.hours}
		<Notice tone="info">Tu usuario no está vinculado a un empleado</Notice>
	{:else}
		{@const weekStart = data.hours.week[0].workDate}
		<DayPunches
			day={data.hours.day}
			isToday={data.today === data.hours.day.workDate}
			employeeName={data.hours.employeeName}
			message={form?.message}
		/>
		<section class="week">
			<WeekPicker
				title="Semana"
				range={formatWeekRange(weekStart)}
				previousHref={weekHref(addDays(weekStart, -7))}
				nextHref={weekStart < currentWeek ? weekHref(addDays(weekStart, 7)) : null}
			/>
			<WeekList
				days={data.hours.week}
				today={data.today}
				selectedDate={data.hours.day.workDate}
				{dayHref}
			/>
		</section>
	{/if}
</Screen>

<style>
	.week {
		margin-top: var(--section-gap);
	}
</style>
