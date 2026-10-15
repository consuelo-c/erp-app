<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import LogoutButton from '$lib/components/LogoutButton.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// After a failed submit the form comes back with what was typed.
	const value = (name: string) => String(form?.values[name] ?? '');
</script>

<svelte:head>
	<title>Nuevo empleado · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Nuevo empleado" backHref={resolve('/personal')}>
			<LogoutButton />
		</ScreenHeader>
	{/snippet}

	<UnsavedChangesGuard form="employee" />

	<!-- The submit button lives in the footer and reaches this form through its `form` attribute. -->
	<form id="employee" class="form-stack" method="POST" use:enhance>
		{#if form?.message}
			<Notice tone="error">{form.message}</Notice>
		{/if}
		<Field label="Nombre completo" id="full_name">
			<Input
				id="full_name"
				name="full_name"
				value={value('full_name')}
				placeholder="Nombre y apellidos"
				required
			/>
		</Field>
		<Field label="Cédula" id="id_number">
			<Input
				id="id_number"
				name="id_number"
				value={value('id_number')}
				placeholder="Número de cédula"
				inputmode="numeric"
				required
			/>
		</Field>
		<Field label="Salario mensual" id="monthly_salary">
			<Input
				id="monthly_salary"
				name="monthly_salary"
				value={value('monthly_salary')}
				placeholder="$0"
				inputmode="numeric"
				required
			/>
		</Field>
		<Field label="Cargo" id="position">
			<Input
				id="position"
				name="position"
				value={value('position')}
				placeholder="Ej. Bodega"
				required
			/>
		</Field>
		<Field label="Fecha de ingreso" id="start" hint="Abre el primer período de trabajo.">
			<Input id="start" name="start" type="date" value={value('start') || data.today} required />
		</Field>
	</form>

	{#snippet footer()}
		<Button type="submit" form="employee">Crear empleado</Button>
	{/snippet}
</Screen>
