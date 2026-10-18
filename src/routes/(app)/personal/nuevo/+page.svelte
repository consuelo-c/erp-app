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
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// After a failed submit the form comes back with what was typed.
	const value = (name: string) => String(form?.values[name] ?? '');

	let employeeForm: HTMLFormElement;
	let confirmOpen = $state(false);

	// Employees are never deleted, so creating one asks first, once the fields are valid.
	function confirmCreate() {
		if (employeeForm.reportValidity()) {
			confirmOpen = true;
		}
	}

	// The dialog closes once the server answers; an error shows above the form.
	const closeConfirm: SubmitFunction = () => {
		return async ({ update }) => {
			await update();
			confirmOpen = false;
		};
	};
</script>

<svelte:head>
	<title>Nuevo empleado · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Nuevo empleado" backHref={resolve('/personal')} />
	{/snippet}

	<UnsavedChangesGuard form="employee" />

	<!-- The submit button sits in the confirmation dialog and reaches this form through its `form` attribute. -->
	<form
		id="employee"
		class="form-stack"
		method="POST"
		use:enhance={closeConfirm}
		bind:this={employeeForm}
	>
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
		<Field label="Cuenta bancaria" id="bank_account" hint="Cuenta a la que se consigna la nómina.">
			<Input
				id="bank_account"
				name="bank_account"
				value={value('bank_account')}
				placeholder="Ej. Cuenta ahorros Bancolombia 123-122334-12"
			/>
		</Field>
		<Field label="Fecha de ingreso" id="start" hint="Abre el primer período de trabajo.">
			<Input id="start" name="start" type="date" value={value('start') || data.today} required />
		</Field>
	</form>

	<div class="screen__action">
		<Button type="button" onclick={confirmCreate}>Crear empleado</Button>
	</div>

	<Modal bind:open={confirmOpen} title="¿Está seguro?">
		{#snippet body()}Un empleado puede <em>desvincularse</em>, pero no borrarse.{/snippet}
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (confirmOpen = false)}>
				Cancelar
			</Button>
			<Button type="submit" form="employee">Crear empleado</Button>
		{/snippet}
	</Modal>
</Screen>
