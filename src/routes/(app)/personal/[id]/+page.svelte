<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatCivilDate } from '$lib/datetime';
	import { formatIdNumber, formatPesos } from '$lib/format';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const employee = $derived(data.employee);
	const current = $derived(employee.employment.at(-1)!);
	// Newest first, the way people read a work history.
	const periods = $derived(employee.employment.toReversed());

	let endOpen = $state(false);
	let rehireOpen = $state(false);

	// After a failed save the fields come back with what was typed.
	const value = (name: string, saved: string) => String(form?.values?.[name] ?? saved);

	// Saving stays on the screen: the fields keep what was typed until the reloaded employee replaces it.
	const keepValues: SubmitFunction = () => {
		return ({ update }) => update({ reset: false });
	};

	// The dialog closes once the server answers; an error shows above the form.
	const closeDialogs: SubmitFunction = () => {
		return async ({ update }) => {
			await update();
			endOpen = false;
			rehireOpen = false;
		};
	};
</script>

<svelte:head>
	<title>{employee.fullName} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title={employee.fullName} backHref={resolve('/personal')} />
	{/snippet}

	<UnsavedChangesGuard form="save" />

	<!-- Every submit button sits outside its form (end of the body, dialogs) and points at it by id. -->
	<form id="save" class="form-stack" method="POST" action="?/save" use:enhance={keepValues}>
		{#if form?.message}
			<Notice tone="error">{form.message}</Notice>
		{:else if form?.saved}
			<Notice tone="success">Datos guardados con éxito</Notice>
		{/if}
		<Field label="Nombre completo" id="full_name">
			<Input
				id="full_name"
				name="full_name"
				value={value('full_name', employee.fullName)}
				required
			/>
		</Field>
		<Field label="Cédula" id="id_number">
			<Input
				id="id_number"
				name="id_number"
				value={value('id_number', formatIdNumber(employee.idNumber))}
				inputmode="numeric"
				required
			/>
		</Field>
		<Field label="Salario mensual" id="monthly_salary">
			<Input
				id="monthly_salary"
				name="monthly_salary"
				value={value('monthly_salary', formatPesos(employee.monthlySalary))}
				inputmode="numeric"
				required
			/>
		</Field>
		<Field label="Cargo" id="position">
			<Input id="position" name="position" value={value('position', employee.position)} required />
		</Field>
		<Field label="Cuenta bancaria" id="bank_account" hint="Cuenta a la que se consigna la nómina.">
			<Input
				id="bank_account"
				name="bank_account"
				value={value('bank_account', employee.bankAccount ?? '')}
				placeholder="Ej. Cuenta ahorros Bancolombia 123-122334-12"
			/>
		</Field>
	</form>

	<section class="periods">
		<div class="periods__head">
			<h2 class="section-title">Períodos de trabajo</h2>
			{#if !employee.isEmployed}
				<Badge>Retirado</Badge>
			{/if}
		</div>
		<ul class="periods__list">
			{#each periods as period (period.start)}
				<li>
					<strong>
						{formatCivilDate(period.start)} – {period.end ? formatCivilDate(period.end) : 'actual'}
					</strong>
					<p class="meta">{period.end ? 'Terminado' : 'Período actual'}</p>
				</li>
			{/each}
		</ul>

		{#if employee.isEmployed}
			<Button type="button" variant="secondary" onclick={() => (endOpen = true)}>
				Terminar contrato
			</Button>
		{:else}
			<Button type="button" variant="secondary" onclick={() => (rehireOpen = true)}>
				Reingresar
			</Button>
		{/if}
	</section>

	<form id="end" method="POST" action="?/end" use:enhance={closeDialogs} hidden></form>
	<Modal
		bind:open={endOpen}
		title="Terminar contrato"
		body="Cierra el período de {employee.fullName} que empezó el {formatCivilDate(current.start)}."
	>
		<Field label="Fecha de retiro" id="end_date">
			<Input id="end_date" name="end" type="date" form="end" value={data.today} required />
		</Field>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (endOpen = false)}>Cancelar</Button>
			<Button type="submit" form="end">Terminar contrato</Button>
		{/snippet}
	</Modal>

	<form id="rehire" method="POST" action="?/rehire" use:enhance={closeDialogs} hidden></form>
	<Modal
		bind:open={rehireOpen}
		title="Reingresar"
		body="Se agrega un período nuevo al historial de {employee.fullName}. No se crea otro empleado."
	>
		<Field label="Fecha de ingreso" id="rehire_date">
			<Input id="rehire_date" name="start" type="date" form="rehire" value={data.today} required />
		</Field>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (rehireOpen = false)}>
				Cancelar
			</Button>
			<Button type="submit" form="rehire">Reingresar</Button>
		{/snippet}
	</Modal>

	<div class="screen__action">
		<Button type="submit" form="save">Guardar cambios</Button>
	</div>
</Screen>

<style>
	p {
		margin: 0;
	}

	.periods {
		margin-top: var(--section-gap);
	}

	.periods__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.periods__list {
		padding: 0 0 0 var(--space-7);
		margin: 0 0 var(--space-8);
		list-style: none;
		border-left: var(--border-w) solid var(--border-default);
	}

	.periods__list li + li {
		margin-top: var(--space-5);
	}
</style>
