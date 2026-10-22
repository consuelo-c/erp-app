<script lang="ts">
	import Badge from '$lib/components/Badge.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { SERVICE_LABELS } from '$lib/labels';
	import { formatPhone, normalizePhone } from '$lib/phone';
	import type { Contact } from '$lib/server/services/contacts';

	// A failed save: its message, each field's error, what was typed.
	type Submitted = {
		message: string;
		errors: Record<string, string>;
		values: Record<string, unknown>;
	};

	interface Props {
		/** Null for a new contact. */
		contact: Contact | null;
		isManager: boolean;
		form: Submitted | null | undefined;
	}

	let { contact, isManager, form }: Props = $props();

	// After a failed save the fields come back with what was typed.
	const value = (name: string, saved: string | null | undefined) =>
		String(form?.values[name] ?? saved ?? '');
	const errorOf = (name: string): string | undefined => form?.errors[name];

	const chosen = $derived(
		Array.isArray(form?.values.services) ? form.values.services : (contact?.services ?? [])
	);

	// For Sales, a set account is the manager's to change, and so is the ID number, always: it's the
	// contact's key. A locked field still posts its saved value: the service rejects a save that
	// changes it.
	const isAccountLocked = $derived(!isManager && null !== (contact?.bankAccount ?? null));

	// What Sales fills in once stays: the hint says so before it's saved.
	const ONCE = 'Cuando la guardes, solo Gerente o Administrador la cambian.';
	const AUTO_HINT = 'Si queda vacío, se asigna uno automático que empieza con @.';
	const accountHint = $derived.by(() => {
		if (isAccountLocked) {
			return lockedHint;
		}
		const hint = 'Para devoluciones al cliente.';
		return isManager ? hint : `${hint} ${ONCE}`;
	});

	// A Colombian number reads «310 442 8890» once typed; anything not valid stays as typed.
	function tidyPhone(event: FocusEvent & { currentTarget: HTMLInputElement }) {
		const phone = normalizePhone(event.currentTarget.value);
		if (null !== phone) {
			event.currentTarget.value = formatPhone(phone);
		}
	}
</script>

<UnsavedChangesGuard form="contact" />

{#if contact?.isEmployee}
	<div class="employee">
		<Badge tone="info">Empleado</Badge>
		<span class="meta">Su salario y su cuenta para nómina están en Personal.</span>
	</div>
{/if}

<!-- The submit button sits in the screen's action bar and reaches this form through its `form` attribute. -->
<form id="contact" class="form-stack" method="POST">
	<Field
		label="Teléfono"
		id="phone"
		hint="Si es de otro país, escríbelo con + y el indicativo: +13055550142."
		error={errorOf('phone')}
	>
		<Input
			id="phone"
			name="phone"
			type="tel"
			inputmode="tel"
			value={value('phone', contact && formatPhone(contact.phone))}
			placeholder="Ej. 310 442 8890"
			onblur={tidyPhone}
			aria-invalid={undefined !== errorOf('phone')}
			required
		/>
	</Field>
	<Field label="Nombre" id="full_name" error={errorOf('full_name')}>
		<Input
			id="full_name"
			name="full_name"
			value={value('full_name', contact?.fullName)}
			placeholder="Ej. Luz Marina Restrepo"
			aria-invalid={undefined !== errorOf('full_name')}
			required
		/>
	</Field>
	<Field
		label="Cédula o NIT (opcional)"
		id="document_id"
		hint={isManager ? AUTO_HINT : lockedHint}
		error={errorOf('document_id')}
	>
		{#if !isManager}
			{@render locked('document_id', contact?.documentId ?? 'Se asigna uno automático')}
			<input type="hidden" name="document_id" value={contact?.documentId ?? ''} />
		{:else}
			<Input
				id="document_id"
				name="document_id"
				value={value('document_id', contact?.documentId)}
				placeholder="Ej. C.C. 71.234.567 o NIT 900.456.123-4"
				aria-invalid={undefined !== errorOf('document_id')}
			/>
		{/if}
	</Field>
	<Field label="Correo (opcional)" id="email" error={errorOf('email')}>
		<Input
			id="email"
			name="email"
			type="email"
			inputmode="email"
			value={value('email', contact?.email)}
			placeholder="Ej. luzmarina.r@gmail.com"
			aria-invalid={undefined !== errorOf('email')}
		/>
	</Field>
	<Field
		label="Dirección (opcional)"
		id="address_1"
		hint="La segunda línea es la que ayuda a encontrar el sitio: apartamento, conjunto o referencias."
	>
		<div class="address">
			<Input
				id="address_1"
				name="address_1"
				value={value('address_1', contact?.address1)}
				placeholder="Ej. Cra 43A #18-95, El Poblado"
			/>
			<Input
				name="address_2"
				aria-label="Apartamento, conjunto o referencias"
				value={value('address_2', contact?.address2)}
				placeholder="Ej. Salón Social Torre Verde, piso 2"
			/>
		</div>
	</Field>
	<Field label="Cuenta bancaria (opcional)" id="bank_account" hint={accountHint}>
		{#if isAccountLocked}
			{@render locked('bank_account', contact?.bankAccount ?? '')}
			<input type="hidden" name="bank_account" value={contact?.bankAccount} />
		{:else}
			<Input
				id="bank_account"
				name="bank_account"
				placeholder="Ej. Nequi 311 908 5512, o banco, tipo, número, titular y su cédula"
				value={value('bank_account', contact?.bankAccount)}
			/>
		{/if}
	</Field>
	<Field
		label="Servicios"
		id="services"
		hint={isManager ? 'Elige los que presta. Sin servicios es un cliente.' : lockedHint}
	>
		{#if isManager}
			<div class="chip-row services" id="services">
				{#each Object.entries(SERVICE_LABELS) as [service, label] (service)}
					<Chip name="services" value={service} {label} checked={chosen.includes(service)} />
				{/each}
			</div>
		{:else}
			{@render locked(
				'services',
				chosen
					.map((service) => SERVICE_LABELS[service as Contact['services'][number]])
					.join(' · ') || 'Ninguno'
			)}
			{#each chosen as service (service)}
				<input type="hidden" name="services" value={service} />
			{/each}
		{/if}
	</Field>
	<Field label="Notas (opcional)" id="notes">
		<textarea
			id="notes"
			name="notes"
			rows="3"
			placeholder="Ej. Llamar después de las 2:00 p.m."
			value={value('notes', contact?.notes)}></textarea>
	</Field>

	{#if form?.message}
		<Notice tone="error">{form.message}</Notice>
	{/if}
</form>

{#snippet lockedHint()}
	<span class="locked-hint"
		><Icon name="lock" size="xs" />Solo Gerente o Administrador lo cambian</span
	>
{/snippet}

<!-- Read in full, only not editable: grey, ink text and a lock, never an empty-looking field. -->
{#snippet locked(id: string, text: string)}
	<div class="locked" {id} aria-readonly="true">
		<span>{text}</span>
		<Icon name="lock" size="sm" />
	</div>
{/snippet}

<style>
	.employee {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		margin-bottom: var(--space-8);
	}

	.address {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.services {
		flex-wrap: wrap;
	}

	textarea,
	.locked {
		box-sizing: border-box;
		width: 100%;
		padding: var(--space-6) var(--space-7);
		margin: 0;
		font: var(--type-input);
		color: var(--text-body);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-input);
	}

	textarea {
		resize: vertical;
		outline: none;
		background: var(--surface-card);
	}

	textarea:focus-visible {
		border-color: var(--border-strong);
	}

	.locked {
		display: flex;
		gap: var(--space-5);
		align-items: flex-start;
		min-height: 48px;
		white-space: pre-line;
		background: var(--surface-subtle);
	}

	.locked > span {
		flex: 1;
		min-width: 0;
	}

	.locked :global(.icon) {
		flex: none;
		margin-top: var(--space-1);
		color: var(--text-secondary);
	}

	.locked-hint {
		display: inline-flex;
		gap: var(--space-3);
		align-items: center;
	}
</style>
