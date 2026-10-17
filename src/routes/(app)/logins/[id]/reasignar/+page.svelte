<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Select from '$lib/components/Select.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Facts from '../../Facts.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const login = $derived(data.login);
	const current = $derived(login.employee?.fullName ?? null);

	let employeeId = $state('');
	let confirmOpen = $state(false);

	const next = $derived(
		data.employees.find((employee) => String(employee.id) === employeeId)?.fullName ?? null
	);
	// The dialog says plainly whose sessions end: the previous person's phone is logged out.
	const confirmation = $derived(
		`El login pasa de ${current ?? 'ningún empleado'} a ${next ?? 'ningún empleado'} con la contraseña nueva. ` +
			(current
				? `Se cierran todas las sesiones abiertas de ${current}.`
				: 'Se cierran todas sus sesiones abiertas.')
	);

	// The fields are checked before asking, since the dialog covers them.
	// Button types its handler for a link too; this one is always the button pointing at the form.
	function askToConfirm(event: MouseEvent) {
		if ((event.currentTarget as HTMLButtonElement).form?.reportValidity()) {
			confirmOpen = true;
		}
	}

	// The dialog closes once the server answers; an error shows above the form.
	const closeDialog: SubmitFunction = () => {
		return async ({ update }) => {
			await update();
			confirmOpen = false;
		};
	};
</script>

<svelte:head>
	<title>Reasignar login · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader
			title="Reasignar login"
			backHref={resolve('/(app)/logins/[id]', { id: String(login.id) })}
		/>
	{/snippet}

	<UnsavedChangesGuard form="reassign" />

	<Facts
		rows={[
			['Login', login.username],
			['Empleado actual', current ?? 'Sin empleado']
		]}
	/>

	<!-- The submit button sits in the dialog and reaches this form through its `form` attribute. -->
	<form id="reassign" class="form-stack" method="POST" use:enhance={closeDialog}>
		{#if form?.message}
			<Notice tone="error">{form.message}</Notice>
		{/if}
		<Field label="Nuevo empleado" id="employee_id">
			<Select id="employee_id" name="employee_id" bind:value={employeeId}>
				<option value="">Sin empleado</option>
				{#each data.employees as employee (employee.id)}
					<option value={String(employee.id)}>{employee.fullName}</option>
				{/each}
			</Select>
		</Field>
		<Field label="Nueva contraseña" id="password">
			<Input
				id="password"
				name="password"
				type="password"
				autocomplete="new-password"
				minlength={8}
				required
			/>
		</Field>
	</form>

	<Modal bind:open={confirmOpen} title="¿Reasignar el login {login.username}?" body={confirmation}>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (confirmOpen = false)}>
				Cancelar
			</Button>
			<Button type="submit" form="reassign">Reasignar</Button>
		{/snippet}
	</Modal>

	<div class="screen__action">
		<Button type="button" form="reassign" onclick={askToConfirm}>Reasignar</Button>
	</div>
</Screen>
