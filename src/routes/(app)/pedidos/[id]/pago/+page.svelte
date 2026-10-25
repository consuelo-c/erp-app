<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Field from '$lib/components/Field.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatBalance, formatInteger, formatPesos } from '$lib/format';
	import { CASH_CONCEPT_LABELS, PAYMENT_METHOD_LABELS } from '$lib/labels';
	import { isOrderInflow, ORDER_PAYMENT_CONCEPTS, type OrderPaymentConcept } from '$lib/orders';
	import { parsePesos } from '$lib/payroll';
	import type { PageProps } from './$types';

	// A sheet over the order: its own screen, closed by ✕ back to the order. What's typed is read
	// off the form; Concepto and Método decide which fields show. Nothing blocks on the amounts: the
	// confirmation warns, and says the payment can't be corrected afterward.
	let { data, form }: PageProps = $props();

	const order = $derived(data.order);
	const carriers = $derived(data.options.carriers);
	const orderHref = $derived(resolve('/(app)/pedidos/[id]', { id: String(order.id) }));

	let entered = $state<FormData | null>(null);
	const typed = (name: string, initial: string) => String(entered?.get(name) ?? initial);
	const errorOf = (name: string): string | undefined => form?.errors?.[name];

	// Money out is the manager's, and a carrier is paid only on an order that has one.
	const concepts = $derived(
		ORDER_PAYMENT_CONCEPTS.filter(
			(option) =>
				isOrderInflow(option) ||
				(data.canPayOut && ('CARRIER_PAYMENT' !== option || 0 < carriers.length))
		)
	);
	const concept = $derived(typed('concept', 'INSTALLMENT') as OrderPaymentConcept);
	const isInflow = $derived(isOrderInflow(concept));
	const isCarrierPayment = $derived('CARRIER_PAYMENT' === concept);
	const method = $derived(typed('payment_method', 'CASH'));
	const trip = $derived(typed('trip', carriers[0]?.trip ?? ''));
	const carrier = $derived(carriers.find((option) => option.trip === trip) ?? carriers[0]);
	const payee = $derived(isCarrierPayment ? typed('payee', carrier.name) : order.client.name);
	const amount = $derived(parsePesos(typed('amount', '')));
	const pending = $derived(pendingOf(concept));

	// A refund goes to the client's account, a carrier payment to the carrier's.
	const savedAccount = $derived(
		isCarrierPayment ? carrier.bankAccount : data.options.clientBankAccount
	);
	const accountHint = $derived(
		null === savedAccount
			? 'Obligatoria.'
			: `Obligatoria. La cuenta guardada de ${isCarrierPayment ? carrier.name : order.client.name}; puedes cambiarla.`
	);

	// Valor starts at what's pending under the concept: the balance, the deposit still to receive,
	// or the one held. Picking another concept fills it again.
	function pendingOf(option: OrderPaymentConcept): number {
		if ('INSTALLMENT' === option) {
			return order.balanceDue;
		}
		if ('SECURITY_DEPOSIT' === option) {
			return order.depositAmount - order.depositHeld;
		}
		if ('DEPOSIT_REFUND' === option) {
			return order.depositHeld;
		}
		return 0;
	}

	const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABELS);
	const TRIP_LABELS = { DELIVERY: 'Entrega', PICKUP: 'Retorno' };

	const methodLabel = $derived(
		'OTHER' === method
			? typed('other_method', '') || PAYMENT_METHOD_LABELS.OTHER
			: PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS]
	);

	// What the confirmation warns about, without blocking.
	const warning = $derived.by(() => {
		if ('INSTALLMENT' === concept && amount > order.balanceDue) {
			return `Supera el saldo del pedido (${formatBalance(order.balanceDue)}).`;
		}
		if ('INSTALLMENT_REFUND' === concept && amount > order.paid) {
			return `Devuelve más de lo pagado (${formatBalance(order.paid)}).`;
		}
		if ('DEPOSIT_REFUND' === concept && amount > order.depositHeld) {
			return `Devuelve más del depósito recibido (${formatBalance(order.depositHeld)}).`;
		}
		return null;
	});

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

<svelte:head>
	<title>Registrar pago · Pedido #{order.id} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Registrar pago">
			<IconButton icon="close" label="Cerrar" href={orderHref} />
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
		<p class="meta payment__lead">Pedido #{order.id} · Saldo {formatBalance(order.balanceDue)}</p>
		<div class="form-stack">
			<fieldset class="choice">
				<legend class="choice__legend">Concepto</legend>
				<div class="chip-row">
					{#each concepts as option (option)}
						<Chip
							type="radio"
							name="concept"
							value={option}
							label={CASH_CONCEPT_LABELS[option]}
							checked={option === concept}
						/>
					{/each}
				</div>
			</fieldset>

			{#if isCarrierPayment && 1 < carriers.length}
				<fieldset class="choice">
					<legend class="choice__legend">¿A cuál transportador?</legend>
					<div class="choice__stack">
						{#each carriers as option (option.trip)}
							<Chip
								type="radio"
								name="trip"
								value={option.trip}
								label="{TRIP_LABELS[option.trip]} · {option.name}"
								checked={option.trip === trip}
							/>
						{/each}
					</div>
				</fieldset>
			{/if}

			<fieldset class="choice">
				<legend class="choice__legend">Método</legend>
				<div class="choice__options">
					{#each METHOD_OPTIONS as [value, label] (value)}
						<Chip type="radio" name="payment_method" {value} {label} checked={value === method} />
					{/each}
				</div>
			</fieldset>

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
						value={data.today}
						required
						aria-invalid={undefined !== errorOf('movement_date')}
					/>
				</Field>
			</div>

			<Field label="Notas (opcional)" id="notes">
				<Input id="notes" name="notes" />
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

	.choice {
		min-width: 0;
		padding: 0;
		margin: 0;
		border: 0;
	}

	/* The same look as a Field's label. */
	.choice__legend {
		padding: 0;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	/* The methods share the row, each a full tap target. */
	.choice__options {
		display: grid;
		grid-auto-columns: 1fr;
		grid-auto-flow: column;
		gap: var(--space-4);
	}

	.choice__options > :global(.chip) {
		justify-content: center;
		min-height: var(--tap-min);
	}

	/* Each carrier on its own line: its trip and its name. */
	.choice__stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.choice__stack > :global(.chip) {
		min-height: var(--tap-min);
	}

	.field-row {
		display: flex;
		gap: var(--control-gap);
	}

	.payment {
		max-width: 560px;
		margin-inline: auto;
	}

	.payment__notice {
		margin-top: var(--space-8);
	}
</style>
