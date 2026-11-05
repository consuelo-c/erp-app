<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import Button from '$lib/components/Button.svelte';
	import Choice from '$lib/components/Choice.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatCivilDate } from '$lib/datetime';
	import { formatIdNumber, formatPesos } from '$lib/format';
	import { formatPhone } from '$lib/phone';
	import type { ReceivableForm } from '$lib/server/services/receivables';

	// Issuing and editing a cuenta de cobro: the client is read-only, and the total follows what's
	// checked. A cuenta always keeps an order: the last one checked can't be unchecked. A partly paid
	// order reads as such and can't be checked.
	interface Props {
		receivable: ReceivableForm;
		hint: string;
		submitLabel: string;
		failure?: { message: string; errors: Record<string, string> } | null;
	}

	let { receivable, hint, submitLabel, failure }: Props = $props();

	const client = $derived(receivable.client);
	const paymentTermsError = $derived(failure?.errors.payment_terms);
	const message = $derived(failure?.errors.orders ?? failure?.message);

	let checkedIds = $derived(receivable.checkedOrderIds);
	const total = $derived(
		receivable.orders
			.filter((order) => checkedIds.includes(order.id))
			.reduce((sum, order) => sum + order.orderTotal, 0)
	);

	// A failed save keeps what was typed and checked.
	const keepValues: SubmitFunction = () => {
		return async ({ update }) => {
			await update({ reset: false });
		};
	};
</script>

<UnsavedChangesGuard form="receivable" />

<form id="receivable" class="form-stack" method="POST" use:enhance={keepValues}>
	<div>
		<span class="client-label">Cliente</span>
		<div class="client-name">{client.name}</div>
		{#if null !== client.documentId}
			<p class="meta client-line">NIT/C.C. {formatIdNumber(client.documentId)}</p>
		{/if}
		<p class="meta client-line">{formatPhone(client.phone)}</p>
	</div>

	{#if null === client.documentId}
		<Notice tone="warning">
			⚠ Este cliente no tiene cédula ni NIT: la cuenta de cobro sale sin documento.
		</Notice>
	{/if}

	<Choice legend="Pedidos" layout="none" {hint}>
		<div class="clients__list">
			{#each receivable.orders as order (order.id)}
				{@const isLastChecked = 1 === checkedIds.length && order.id === checkedIds[0]}
				<label class="client">
					<input
						type="checkbox"
						name="orders"
						value={order.id}
						bind:group={checkedIds}
						disabled={isLastChecked || !order.canJoin}
					/>
					<span class="client__text">
						<span class="client__name">Pedido #{order.id}</span>
						<span class="meta">
							{formatCivilDate(order.eventDate)} · {formatPesos(order.orderTotal)}
							{#if !order.canJoin}· Con pago parcial{/if}
						</span>
					</span>
				</label>
				<!-- A disabled checkbox isn't posted. -->
				{#if isLastChecked}
					<input type="hidden" name="orders" value={order.id} />
				{/if}
			{/each}
		</div>
	</Choice>

	<Field label="Forma de pago" id="payment_terms" error={paymentTermsError}>
		<Input
			id="payment_terms"
			name="payment_terms"
			value={receivable.paymentTerms}
			required
			aria-invalid={undefined !== paymentTermsError}
		/>
	</Field>

	<ul class="detail-list">
		<li class="detail-list__row--strong"><span>Total</span><span>{formatPesos(total)}</span></li>
	</ul>

	{#if message}
		<Notice tone="error">{message}</Notice>
	{/if}

	<Button type="submit">{submitLabel}</Button>
</form>

<style>
	.client-label {
		display: block;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	.client-name {
		font-size: var(--text-base);
		font-weight: var(--weight-bold);
	}

	.client-line {
		margin: 0;
	}
</style>
