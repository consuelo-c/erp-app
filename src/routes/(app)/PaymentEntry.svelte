<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Choice from '$lib/components/Choice.svelte';
	import Field from '$lib/components/Field.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatInteger, formatPesos } from '$lib/format';
	import { CASH_CONCEPT_LABELS, PAYMENT_METHOD_LABELS } from '$lib/labels';
	import { isOrderInflow, type OrderPaymentConcept } from '$lib/orders';
	import { parsePesos } from '$lib/payroll';
	import type { PaymentMethod } from '$lib/server/services/cash';
	import type { PayableCarrier } from '$lib/server/services/orders';

	// The payment entry of an order and of a cuenta de cobro: a sheet over it, its own screen, closed
	// by ✕ back to it. What's typed is read off the form; Concepto and Método decide which fields
	// show. Nothing blocks on the amounts: the confirmation warns, and says the payment can't be
	// corrected afterward.
	type Props = {
		lead: string;
		/** Why a concept isn't offered, under Concepto. */
		conceptNote?: string;
		closeHref: string;
		/** The first one starts picked. */
		concepts: readonly OrderPaymentConcept[];
		initialMethod?: PaymentMethod;
		notesPlaceholder?: string;
		clientName: string;
		clientBankAccount?: string | null;
		carriers?: PayableCarrier[];
		today: string;
		form: { message?: string; errors?: Record<string, string> } | null | undefined;
		/** What Valor starts at under a concept; picking another fills it again. */
		pendingOf: (concept: OrderPaymentConcept) => number;
		/** What the confirmation warns about, without blocking. */
		warningOf: (concept: OrderPaymentConcept, amount: number) => string | null;
	};

	let {
		lead,
		conceptNote,
		closeHref,
		concepts,
		initialMethod = 'CASH',
		notesPlaceholder,
		clientName,
		clientBankAccount = null,
		carriers = [],
		today,
		form,
		pendingOf,
		warningOf
	}: Props = $props();

	let entered = $state<FormData | null>(null);
	const typed = (name: string, initial: string) => String(entered?.get(name) ?? initial);
	const errorOf = (name: string): string | undefined => form?.errors?.[name];

	const concept = $derived(typed('concept', concepts[0]) as OrderPaymentConcept);
	const isInflow = $derived(isOrderInflow(concept));
	const isCarrierPayment = $derived('CARRIER_PAYMENT' === concept);
	const method = $derived(typed('payment_method', initialMethod));
	const trip = $derived(typed('trip', carriers[0]?.trip ?? ''));
	const carrier = $derived(carriers.find((option) => option.trip === trip) ?? carriers[0]);
	const payee = $derived(isCarrierPayment ? typed('payee', carrier.name) : clientName);
	const amount = $derived(parsePesos(typed('amount', '')));
	const pending = $derived(pendingOf(concept));
	const warning = $derived(warningOf(concept, amount));

	// A refund goes to the client's account, a carrier payment to the carrier's.
	const savedAccount = $derived(isCarrierPayment ? carrier.bankAccount : clientBankAccount);
	const accountHint = $derived(
		null === savedAccount
			? 'Obligatoria.'
			: `Obligatoria. La cuenta guardada de ${isCarrierPayment ? carrier.name : clientName}; puedes cambiarla.`
	);

	const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABELS);
	const TRIP_LABELS = { DELIVERY: 'Entrega', PICKUP: 'Retorno' };

	const methodLabel = $derived(
		'OTHER' === method
			? typed('other_method', '') || PAYMENT_METHOD_LABELS.OTHER
			: PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS]
	);

	let isConfirmOpen = $state(false);

	// The fields are checked before asking, since the dialog covers them; the dialog reads them as
	// they are now, a pre-filled field included.
	function askToConfirm(event: MouseEvent) {
		const paymentForm = (event.currentTarget as HTMLButtonElement).form;
		if (paymentForm?.reportValidity()) {
			entered = new FormData(paymentForm);
			isConfirmOpen = true;
		}
	}

	// A failed save keeps what was typed; the dialog closes once the server answers.
	const keepValues: SubmitFunction = () => {
		return async ({ update }) => {
			await update({ reset: false });
			isConfirmOpen = false;
		};
	};
</script>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Registrar pago">
			<IconButton icon="close" label="Cerrar" href={closeHref} />
		</ScreenHeader>
	{/snippet}

	<UnsavedChangesGuard form="payment" />

	<form
		id="payment"
		class="payment"
		method="POST"
		use:enhance={keepValues}
		oninput={(event) => (entered = new FormData(event.currentTarget))}
	>
		<p class="meta payment__lead">{lead}</p>
		<div class="form-stack">
			<Choice legend="Concepto" layout={1 < concepts.length ? 'scroll' : 'grid'} hint={conceptNote}>
				{#each concepts as option (option)}
					<Chip
						type="radio"
						name="concept"
						value={option}
						label={CASH_CONCEPT_LABELS[option]}
						checked={option === concept}
					/>
				{/each}
			</Choice>

			{#if isCarrierPayment && 1 < carriers.length}
				<!-- Each carrier on its own line: its trip and its name. -->
				<Choice legend="¿A cuál transportador?" layout="stack">
					{#each carriers as option (option.trip)}
						<Chip
							type="radio"
							name="trip"
							value={option.trip}
							label="{TRIP_LABELS[option.trip]} · {option.name}"
							checked={option.trip === trip}
						/>
					{/each}
				</Choice>
			{/if}

			<Choice legend="Método">
				{#each METHOD_OPTIONS as [value, label] (value)}
					<Chip type="radio" name="payment_method" {value} {label} checked={value === method} />
				{/each}
			</Choice>

			{#if 'OTHER' === method}
				<Field label="¿Cuál medio de pago?" id="other_method" error={errorOf('other_method')}>
					<Input
						id="other_method"
						name="other_method"
						placeholder="Intercambio o por definir"
						required
						aria-invalid={undefined !== errorOf('other_method')}
					/>
				</Field>
			{/if}

			<!-- Picking another carrier, or another concept, fills these again from its contact. -->
			{#if isCarrierPayment}
				<Field label="Pagado a" id="payee" error={errorOf('payee')}>
					<Input id="payee" name="payee" value={carrier.name} required />
				</Field>
			{/if}

			<!-- The bank an inflow came into; the account an outflow was paid to, pre-filled. -->
			{#if 'TRANSFER' === method}
				<Field
					label={isInflow ? '¿A cuál banco?' : 'Cuenta de destino'}
					id="bank_account"
					hint={isInflow ? 'Y la cuenta, si la sabes.' : accountHint}
					error={errorOf('bank_account')}
				>
					<Input
						id="bank_account"
						name="bank_account"
						placeholder="Ej. Bancolombia ahorros 123-456789-01"
						value={isInflow ? undefined : (savedAccount ?? undefined)}
						required
						aria-invalid={undefined !== errorOf('bank_account')}
					/>
				</Field>
			{/if}

			<div class="field-row">
				<Field label="Valor" id="amount" error={errorOf('amount')}>
					<Input
						id="amount"
						name="amount"
						inputmode="numeric"
						placeholder="$0"
						value={0 < pending ? formatInteger(pending) : ''}
						required
						aria-invalid={undefined !== errorOf('amount')}
					/>
				</Field>
				<Field label="Fecha" id="movement_date" error={errorOf('movement_date')}>
					<Input
						id="movement_date"
						name="movement_date"
						type="date"
						value={today}
						required
						aria-invalid={undefined !== errorOf('movement_date')}
					/>
				</Field>
			</div>

			<Field label="Notas (opcional)" id="notes">
				<Input id="notes" name="notes" placeholder={notesPlaceholder} />
			</Field>
		</div>

		{#if form?.message}
			<div class="payment__notice">
				<Notice tone="error">{form.message}</Notice>
			</div>
		{/if}

		<div class="screen__action">
			<Button type="button" onclick={askToConfirm}>Guardar pago</Button>
		</div>
	</form>
</Screen>

<Modal
	bind:open={isConfirmOpen}
	title="Confirmar pago"
	body="Los pagos no se pueden corregir después."
>
	<ul class="detail-list">
		<li class="detail-list__row--plain">
			<span>Concepto</span><span>{CASH_CONCEPT_LABELS[concept]}</span>
		</li>
		<li><span>Valor</span><span>{formatPesos(amount)}</span></li>
		<li class="detail-list__row--plain"><span>Método</span><span>{methodLabel}</span></li>
		<li class="detail-list__row--plain">
			<span>{isInflow ? 'Recibido de' : 'Pagado a'}</span><span>{payee}</span>
		</li>
	</ul>
	{#if warning}
		<div class="payment__notice">
			<Notice tone="warning">⚠ {warning} Puedes continuar igual.</Notice>
		</div>
	{/if}
	{#snippet actions()}
		<Button type="button" variant="secondary" onclick={() => (isConfirmOpen = false)}>
			Cancelar
		</Button>
		<Button type="submit" form="payment" size="md">Confirmar</Button>
	{/snippet}
</Modal>

<style>
	.payment__lead {
		margin: 0 0 var(--space-8);
	}

	.field-row {
		display: flex;
		gap: var(--control-gap);
	}

	.payment__notice {
		margin-top: var(--space-8);
	}
</style>
