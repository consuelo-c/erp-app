<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Select from '$lib/components/Select.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { HOURS_TABS } from '$lib/navigation';
	import HoursView from '../HoursView.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Every link keeps the chosen employee.
	function href(query: Record<string, string>): string {
		const search = new URLSearchParams({ empleado: String(data.hours?.employeeId), ...query });
		return `${resolve('/(app)/horas/empleado')}?${search}`;
	}
</script>

<svelte:head>
	<title>Horas de un empleado · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={HOURS_TABS} current="Empleado" /></ScreenHeader>
	{/snippet}

	{#if null === data.hours}
		<Notice tone="info">Todavía no hay empleados</Notice>
	{:else}
		<!-- Picking the wrong person is the costly mistake: the selector comes first. Choosing loads that
		     employee's today; without JS, «Ver» does it. -->
		<form class="selector" method="GET">
			<Field label="Empleado" id="empleado">
				<Select
					id="empleado"
					name="empleado"
					value={String(data.hours.employeeId)}
					onchange={(event) => event.currentTarget.form?.requestSubmit()}
				>
					{#each data.employees as employee (employee.id)}
						<option value={String(employee.id)}>
							{employee.fullName} — {employee.position}{employee.isEmployed ? '' : ' (retirado)'}
						</option>
					{/each}
				</Select>
			</Field>
			<noscript><Button type="submit" variant="secondary" size="sm" inline>Ver</Button></noscript>
		</form>
		<HoursView
			hours={data.hours}
			today={data.today}
			{href}
			employeeId={data.hours.employeeId}
			message={form?.message}
		/>
	{/if}
</Screen>

<style>
	.selector {
		margin-bottom: var(--section-gap);
	}

	.selector :global(.select) {
		font-weight: var(--weight-bold);
	}
</style>
