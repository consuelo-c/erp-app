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
	import Select from '$lib/components/Select.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import RolesField from '../RolesField.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Nuevo login · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Nuevo login" backHref={resolve('/logins')}>
			<LogoutButton />
		</ScreenHeader>
	{/snippet}

	<UnsavedChangesGuard form="login" />

	<!-- After a failed submit the form comes back with what was chosen, the password excepted.
	     The submit button sits after the form and reaches this form through its `form` attribute. -->
	<form id="login" class="form-stack" method="POST" use:enhance>
		{#if form?.message}
			<Notice tone="error">{form.message}</Notice>
		{/if}
		<Field label="Usuario" id="username">
			<Input
				id="username"
				name="username"
				value={form?.values.username ?? ''}
				placeholder="Ej. bodega"
				autocapitalize="none"
				autocomplete="off"
				required
			/>
		</Field>
		<RolesField chosen={form?.values.roles ?? []} />
		<Field label="Empleado (opcional)" id="employee_id">
			<Select id="employee_id" name="employee_id" value={form?.values.employee_id ?? ''}>
				<option value="">Sin empleado</option>
				{#each data.employees as employee (employee.id)}
					<option value={String(employee.id)}>{employee.fullName}</option>
				{/each}
			</Select>
		</Field>
		<Field label="Contraseña" id="password">
			<Input
				id="password"
				name="password"
				type="password"
				placeholder="Contraseña inicial"
				autocomplete="new-password"
				minlength={8}
				required
			/>
		</Field>
	</form>

	<div class="screen__action">
		<Button type="submit" form="login">Crear login</Button>
	</div>
</Screen>
