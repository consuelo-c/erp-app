<script lang="ts">
	import { resolve } from '$app/paths';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import HoursView from './HoursView.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	function href(query: Record<string, string>): string {
		const search = new URLSearchParams(query).toString();
		const hours = resolve('/(app)/horas');
		return '' === search ? hours : `${hours}?${search}`;
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
		<HoursView
			hours={data.hours}
			today={data.today}
			{href}
			employeeName={data.hours.employeeName}
			message={form?.message}
		/>
	{/if}
</Screen>
