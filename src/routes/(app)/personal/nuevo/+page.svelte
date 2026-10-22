<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatIdNumber } from '$lib/format';
	import { formatPhone } from '$lib/phone';
	import type { ContactCandidate } from '$lib/server/services/employees';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// After a failed submit the form comes back with what was typed.
	const value = (name: string) => String(form?.values[name] ?? '');
	const errorOf = (name: string): string | undefined => form?.errors?.[name];

	// Filled in from the contact picked in the search; after a failed submit, what was typed.
	let phone = $state(value('phone'));
	let fullName = $state(value('full_name'));
	let documentId = $state(value('document_id'));
	let picked = $state<{ id: number; fullName: string } | null>(
		value('contact_id') ? { id: Number(value('contact_id')), fullName: value('full_name') } : null
	);
	let candidates = $state<ContactCandidate[]>([]);

	let typing: ReturnType<typeof setTimeout> | undefined;
	let latestSearch = '';

	// Searched once the typing pauses; an answer to an older search is dropped.
	function searchSoon(event: Event & { currentTarget: HTMLInputElement }) {
		const search = event.currentTarget.value;
		latestSearch = search;
		clearTimeout(typing);
		typing = setTimeout(() => searchContacts(search), 300);
	}

	async function searchContacts(search: string) {
		const query = new URLSearchParams({ texto: search });
		const response = await fetch(`${resolve('/personal/nuevo/contacto')}?${query}`);
		const found: ContactCandidate[] = response.ok ? await response.json() : [];
		if (search === latestSearch) {
			candidates = found;
		}
	}

	// An automatic document isn't payroll's: the real cédula is typed.
	function pick(candidate: ContactCandidate) {
		picked = { id: candidate.id, fullName: candidate.fullName };
		phone = formatPhone(candidate.phone);
		fullName = candidate.fullName;
		documentId = candidate.documentId ? formatIdNumber(candidate.documentId) : '';
		candidates = [];
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

	<!-- Outside the form: the search posts nothing, and Enter on it doesn't submit. -->
	<div class="lookup">
		<Field
			label="Buscar en Contactos"
			id="contact_search"
			hint="Por nombre, teléfono, correo o cédula. Si no está, llena los datos y se crea."
		>
			<label class="search">
				<Icon name="search" size="sm" />
				<Input
					id="contact_search"
					type="search"
					placeholder="Ej. Carlos o 310 442"
					oninput={searchSoon}
				/>
			</label>
		</Field>
		{#if picked}
			<div class="picked">
				<span class="meta">✓ Se usará el contacto de <strong>{picked.fullName}</strong></span>
				<Button type="button" variant="secondary" inline onclick={() => (picked = null)}>
					Quitar
				</Button>
			</div>
		{:else if candidates.length}
			<ul class="candidates">
				{#each candidates as candidate (candidate.id)}
					<li>
						<button
							type="button"
							class="candidate"
							disabled={candidate.isEmployee}
							onclick={() => pick(candidate)}
						>
							<span class="candidate__name">{candidate.fullName}</span>
							<span class="meta">{formatPhone(candidate.phone)}</span>
							{#if candidate.isEmployee}
								<Badge tone="info">Empleado</Badge>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

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
		<input type="hidden" name="contact_id" value={picked?.id ?? ''} />
		<Field label="Teléfono" id="phone" error={errorOf('phone')}>
			<Input
				id="phone"
				name="phone"
				type="tel"
				inputmode="tel"
				bind:value={phone}
				placeholder="Ej. 310 442 8890"
				aria-invalid={undefined !== errorOf('phone')}
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

<style>
	.lookup {
		margin-bottom: var(--space-8);
	}

	.search {
		position: relative;
		display: block;
	}

	.search :global(.icon) {
		position: absolute;
		top: 50%;
		left: var(--input-icon-inset);
		color: var(--text-disabled);
		pointer-events: none;
		translate: 0 -50%;
	}

	.search :global(.input) {
		padding-left: var(--input-icon-pad);
	}

	.picked {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		justify-content: space-between;
		margin-top: var(--space-5);
	}

	.candidates {
		padding: 0;
		margin: var(--space-5) 0 0;
		list-style: none;
		border-top: var(--border-w) solid var(--border-default);
	}

	.candidate {
		box-sizing: border-box;
		display: flex;
		gap: var(--space-4);
		align-items: center;
		width: 100%;
		min-height: var(--tap-min);
		padding: var(--space-4) 0;
		font: inherit;
		color: var(--text-body);
		text-align: left;
		cursor: pointer;
		background: none;
		border: 0;
		border-bottom: var(--border-w) solid var(--border-default);
	}

	.candidate:disabled {
		color: var(--text-disabled);
		cursor: default;
	}

	.candidate__name {
		flex: 1;
		min-width: 0;
		font-weight: var(--weight-semibold);
	}
</style>
