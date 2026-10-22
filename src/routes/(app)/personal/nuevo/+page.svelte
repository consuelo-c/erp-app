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
	import { formatIdNumber } from '$lib/format';
	import type { PhoneMatch } from '$lib/server/services/employees';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// After a failed submit the form comes back with what was typed.
	const value = (name: string) => String(form?.values[name] ?? '');
	const errorOf = (name: string): string | undefined => form?.errors?.[name];

	// Filled in from the contact a typed phone already belongs to.
	let fullName = $state(value('full_name'));
	let documentId = $state(value('document_id'));
	let match = $state<PhoneMatch | null>(null);

	const phoneError = $derived(match?.error ?? errorOf('phone'));
	const isReused = $derived(null !== match && null === match.error);

	async function matchPhone(event: Event & { currentTarget: HTMLInputElement }) {
		const query = new URLSearchParams({ telefono: event.currentTarget.value });
		const response = await fetch(`${resolve('/personal/nuevo/contacto')}?${query}`);
		match = response.ok ? await response.json() : null;
		if (null !== match && null === match.error) {
			fullName = match.fullName;
			documentId = match.documentId ? formatIdNumber(match.documentId) : '';
		}
	}

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
		<Field
			label="Teléfono"
			id="phone"
			hint={isReused
				? '✓ Ya está en Contactos: se usará ese contacto'
				: 'Si ya está en Contactos, se llenan el nombre y la cédula.'}
			error={phoneError}
		>
			<Input
				id="phone"
				name="phone"
				type="tel"
				inputmode="tel"
				value={value('phone')}
				placeholder="Ej. 310 442 8890"
				onchange={matchPhone}
				aria-invalid={undefined !== phoneError}
				required
			/>
		</Field>
		<Field label="Nombre completo" id="full_name" error={errorOf('full_name')}>
			<Input
				id="full_name"
				name="full_name"
				bind:value={fullName}
				placeholder="Nombre y apellidos"
				aria-invalid={undefined !== errorOf('full_name')}
				required
			/>
		</Field>
		<Field label="Cédula" id="document_id" error={errorOf('document_id')}>
			<Input
				id="document_id"
				name="document_id"
				bind:value={documentId}
				placeholder="Número de cédula"
				inputmode="numeric"
				aria-invalid={undefined !== errorOf('document_id')}
				required
			/>
		</Field>
		<Field label="Salario mensual" id="monthly_salary" error={errorOf('monthly_salary')}>
			<Input
				id="monthly_salary"
				name="monthly_salary"
				value={value('monthly_salary')}
				placeholder="$0"
				inputmode="numeric"
				required
			/>
		</Field>
		<Field label="Cargo" id="position" error={errorOf('position')}>
			<Input
				id="position"
				name="position"
				value={value('position')}
				placeholder="Ej. Bodega"
				required
			/>
		</Field>
		<Field
			label="Cuenta para nómina"
			id="salary_bank_account"
			hint="Adonde se transfiere la nómina."
			error={errorOf('salary_bank_account')}
		>
			<Input
				id="salary_bank_account"
				name="salary_bank_account"
				value={value('salary_bank_account')}
				placeholder="Ej. Bancolombia ahorros 123-456789-01"
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
