<script lang="ts">
	import { resolve } from '$app/paths';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import LogoutButton from '$lib/components/LogoutButton.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatCivilDate } from '$lib/datetime';
	import { formatIdNumber } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Empleados · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Empleados">
			<LogoutButton />
		</ScreenHeader>
	{/snippet}

	{#each data.employees as employee (employee.id)}
		<Card
			href={resolve('/personal/[id]', { id: String(employee.id) })}
			dimmed={!employee.isEmployed}
		>
			{#snippet head()}
				<strong>{employee.fullName}</strong>
			{/snippet}
			<p class="meta">CC {formatIdNumber(employee.idNumber)} · {employee.position}</p>
			{#if employee.isEmployed}
				<p>Desde {formatCivilDate(employee.employment.at(-1)!.start)}</p>
			{:else}
				<Badge>Retirado</Badge>
			{/if}
		</Card>
	{:else}
		<!-- Empty state: the action sits centered under the message. -->
		<div class="empty">
			<p><strong>Aún no hay empleados</strong></p>
			<p class="meta">Crea el primero con Nuevo empleado.</p>
			<div class="empty__action">{@render newEmployee()}</div>
		</div>
	{/each}

	{#if data.employees.length}
		<div class="screen__action">{@render newEmployee()}</div>
	{/if}
</Screen>

{#snippet newEmployee()}
	<Button href={resolve('/personal/nuevo')}>Nuevo empleado</Button>
{/snippet}

<style>
	p {
		margin: 0;
	}

	.empty {
		display: grid;
		place-content: center;
		height: 100%;
		text-align: center;
	}

	.empty__action {
		margin-top: var(--space-8);
	}
</style>
