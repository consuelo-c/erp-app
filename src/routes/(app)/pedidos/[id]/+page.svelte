<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge, { ORDER_STATUS_TONES } from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatClockTime, formatInstant, formatLongDay, formatShortDay } from '$lib/datetime';
	import { formatBalance, formatPesos, formatReceiptNumber, formatSignedPesos } from '$lib/format';
	import {
		CASH_CONCEPT_LABELS,
		DELIVERY_METHOD_LABELS,
		ORDER_STATUS_LABELS,
		PAYMENT_METHOD_LABELS,
		RETURN_METHOD_LABELS
	} from '$lib/labels';
	import { isEditableStatus, isLegalTransition } from '$lib/orders';
	import { formatPhone } from '$lib/phone';
	import type { Carrier, OrderPayment } from '$lib/server/services/orders';
	import type { PageProps } from './$types';

	// The order as everyone at the office reads it: who, where, when, what, and its money. The
	// actions follow its state; an outstanding balance is shown, never treated as an error.
	let { data, form }: PageProps = $props();

	const order = $derived(data.order);
	const delivery = $derived(order.delivery);
	const pickup = $derived(order.pickup);

	const isDraft = $derived('DRAFT' === order.status);
	const canEdit = $derived(isEditableStatus(order.status));
	const canCancel = $derived(
		isLegalTransition({
			from: order.status,
			to: 'CANCELLED',
			deliveryMethod: delivery.method,
			returnMethod: pickup.method
		})
	);
	// The pickup address only when the products come back from somewhere else.
	const isPickupElsewhere = $derived(
		delivery.address_1 !== pickup.address_1 || delivery.address_2 !== pickup.address_2
	);

	let isConfirmOpen = $state(false);
	let isCancelOpen = $state(false);
	let reason = $state('');

	function tripWhen(date: string, time: string | null): string {
		return null === time
			? formatShortDay(date)
			: `${formatShortDay(date)} · ${formatClockTime(time)}`;
	}

	function mapsHref(address: string): string {
		return `https://www.google.com/maps/search/?api=1&${new URLSearchParams({ query: address })}`;
	}

	// Set by the payment entry's redirect: the payment just recorded, its receipt next.
	const recordedPayment = $derived(
		order.payments.find((payment) => String(payment.id) === page.url.searchParams.get('pago'))
	);

	function receiptHref(payment: OrderPayment): string {
		const query = new URLSearchParams({ movimiento: String(payment.id) });
		return `${resolve('/(app)/caja/comprobante')}?${query}`;
	}

	// The method, and who a carrier payment went to: the client is the order's own.
	function paymentMeta(payment: OrderPayment): string {
		const method = payment.otherMethod ?? PAYMENT_METHOD_LABELS[payment.method];
		const payee = 'CARRIER_PAYMENT' === payment.concept ? payment.payee : null;
		return [formatLongDay(payment.movementDate), method, payee, receiptName(payment)]
			.filter(Boolean)
			.join(' · ');
	}

	function receiptName(payment: OrderPayment): string {
		const title = 0 < payment.amount ? 'Recibo de caja' : 'Comprobante de egreso';
		return `${title} # ${formatReceiptNumber(payment.receiptNumber)}`;
	}

	function startCancel() {
		reason = '';
		isCancelOpen = true;
	}

	// Each dialog saves on its own and closes once saved; a refusal keeps it open with its message.
	function closeOnSuccess(close: () => void): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if ('success' === result.type) {
					close();
				}
				await update({ reset: false });
			};
	}
</script>

<svelte:head>
	<title>Pedido #{order.id} · Banquetes Consuelo C</title>
</svelte:head>

{#snippet carrierRow(carrier: Carrier)}
	<li class="detail-list__row--plain">
		<span>Transportador</span>
		<span
			>{carrier.name} ·
			<a href="https://wa.me/{carrier.phone}">{formatPhone(carrier.phone)}</a></span
		>
	</li>
{/snippet}

{#snippet address(line1: string, line2: string | null)}
	<span class="address">
		<span>
			{line1}
			{#if line2}<span class="meta">{line2}</span>{/if}
		</span>
		<IconButton
			icon="pin"
			label="Abrir en Google Maps"
			href={mapsHref(line1)}
			target="_blank"
			rel="noopener"
		/>
	</span>
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader title="Pedido #{order.id}" backHref={resolve('/pedidos')}>
			<span class="badges">
				<Badge tone={ORDER_STATUS_TONES[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
				{#if order.hasIncident}
					<Badge tone="error">Con novedad</Badge>
				{/if}
			</span>
		</ScreenHeader>
	{/snippet}

	<!-- Set by the order form's redirect after a save. -->
	{#if page.url.searchParams.has('guardado')}
		<div class="lead-notice"><Notice tone="success">Pedido guardado con éxito</Notice></div>
	{/if}

	{#if recordedPayment}
		<div class="lead-notice">
			<Notice tone="success">
				Pago registrado: {CASH_CONCEPT_LABELS[recordedPayment.concept]} · {formatPesos(
					Math.abs(recordedPayment.amount)
				)}
			</Notice>
		</div>
	{/if}

	{#if order.parentOrderId}
		<div class="lead-notice">
			<Notice tone="info">
				Extensión del pedido
				<a href={resolve('/(app)/pedidos/[id]', { id: String(order.parentOrderId) })}
					>#{order.parentOrderId}</a
				>
			</Notice>
		</div>
	{/if}

	{#if order.cancellation}
		<div class="lead-notice">
			<Notice tone="info">
				Cancelado el {formatInstant(order.cancellation.cancelledAt)} por {order.cancellation
					.cancelledBy}: {order.cancellation.reason}. Solo se pueden registrar pagos.
			</Notice>
		</div>
	{/if}

	<h2 class="section-title client">{order.client.name}</h2>
	<div class="reach">
		<span>{formatPhone(order.client.phone)}</span>
		<IconButton
			icon="phone"
			label="Llamar a {order.client.name}"
			href="tel:+{order.client.phone}"
		/>
		<IconButton
			icon="whatsapp"
			label="Escribir por WhatsApp a {order.client.name}"
			href="https://wa.me/{order.client.phone}"
			target="_blank"
			rel="noopener"
		/>
	</div>
	<div class="delivery-address">{@render address(delivery.address_1, delivery.address_2)}</div>

	<!-- Payments are recorded in any state, a cancelled order's refunds included. -->
	<div class="actions">
		{#if isDraft}
			<Button size="sm" onclick={() => (isConfirmOpen = true)}>Confirmar</Button>
		{/if}
		<!-- Products already at the client's, kept for more days: a new order. -->
		{#if 'DELIVERED' === order.status}
			<Button
				variant="secondary"
				size="sm"
				href={resolve('/(app)/pedidos/[id]/extension', { id: String(order.id) })}
			>
				Crear extensión
			</Button>
		{/if}
		{#if canEdit}
			<Button
				variant="secondary"
				size="sm"
				href={resolve('/(app)/pedidos/[id]/editar', { id: String(order.id) })}
			>
				Editar
			</Button>
		{/if}
		<Button
			variant="secondary"
			size="sm"
			href={resolve('/(app)/pedidos/[id]/pago', { id: String(order.id) })}
		>
			Registrar pago
		</Button>
		<Button
			variant="secondary"
			size="sm"
			href={resolve('/(app)/pedidos/[id]/impresion', { id: String(order.id) })}
		>
			Imprimir
		</Button>
		<Button
			variant="secondary"
			size="sm"
			href={resolve('/(app)/pedidos/[id]/historial', { id: String(order.id) })}
		>
			Historial
		</Button>
		{#if canCancel}
			<span class="actions__cancel">
				<Button variant="secondary" size="sm" onclick={startCancel}>Cancelar pedido</Button>
			</span>
		{/if}
	</div>

	{#if order.extensions.length}
		<h2 class="section-title">Extensiones</h2>
		<ul class="detail-list">
			{#each order.extensions as extension (extension.id)}
				<li>
					<a href={resolve('/(app)/pedidos/[id]', { id: String(extension.id) })}>
						#{extension.id} · {formatShortDay(extension.deliveryDate)} – {formatShortDay(
							extension.pickupDate
						)}
					</a>
					<Badge tone={ORDER_STATUS_TONES[extension.status]}>
						{ORDER_STATUS_LABELS[extension.status]}
					</Badge>
				</li>
			{/each}
		</ul>
	{/if}

	<h2 class="section-title">Entrega y recogida</h2>
	<ul class="detail-list">
		<li><span>↧ Entrega</span><span>{tripWhen(order.deliveryDate, delivery.time)}</span></li>
		<li class="detail-list__row--plain">
			<span>Método de entrega</span><span>{DELIVERY_METHOD_LABELS[delivery.method]}</span>
		</li>
		{#if delivery.carrier}
			{@render carrierRow(delivery.carrier)}
		{/if}
		<li><span>↥ Recogida</span><span>{tripWhen(order.pickupDate, pickup.time)}</span></li>
		<li class="detail-list__row--plain">
			<span>Método de retorno</span><span>{RETURN_METHOD_LABELS[pickup.method]}</span>
		</li>
		{#if pickup.carrier}
			{@render carrierRow(pickup.carrier)}
		{/if}
		{#if isPickupElsewhere}
			<li class="detail-list__row--plain">
				<span>Dirección de recogida</span>
				{@render address(pickup.address_1, pickup.address_2)}
			</li>
		{/if}
		<li class="detail-list__row--plain">
			<span>Días cobrados</span><span>{order.rentalDays}</span>
		</li>
	</ul>

	<h2 class="section-title">Evento</h2>
	<ul class="detail-list">
		<li><span>Fecha del evento</span><span>{formatLongDay(order.eventDate)}</span></li>
	</ul>

	{#if order.notes}
		<h2 class="section-title">Notas</h2>
		<p class="notes">{order.notes}</p>
	{/if}

	<h2 class="section-title">Productos ({order.items.length})</h2>
	<ul class="detail-list">
		{#each order.items as item (item.product_id)}
			<li>
				<span>
					{item.qty} × {item.name}
					<span class="meta"
						>Lista {formatPesos(item.list_price)} · Cobrado {formatPesos(item.unit_price)}</span
					>
				</span>
				<span>{formatPesos(item.line_total)}</span>
			</li>
		{/each}
	</ul>

	<h2 class="section-title">Totales</h2>
	<ul class="detail-list">
		<li class="detail-list__row--plain">
			<span>Subtotal</span><span>{formatPesos(order.itemsTotal)}</span>
		</li>
		<li class="detail-list__row--plain">
			<span>Descuento</span>
			<span>{0 === order.discount ? formatPesos(0) : `−${formatPesos(order.discount)}`}</span>
		</li>
		<li class="detail-list__row--plain">
			<span>Transporte</span><span>{formatPesos(order.transportCost)}</span>
		</li>
		<li class="detail-list__row--strong">
			<span>Total</span><span>{formatPesos(order.orderTotal)}</span>
		</li>
		<li class="detail-list__row--plain">
			<span>Pagado</span><span>{formatBalance(order.paid)}</span>
		</li>
		<li class="detail-list__row--strong">
			<span>Saldo</span><span>{formatBalance(order.balanceDue)}</span>
		</li>
		<li class="detail-list__row--plain deposit">
			<span>Depósito acordado</span><span>{formatPesos(order.depositAmount)}</span>
		</li>
		<li class="detail-list__row--plain">
			<span>Depósito recibido</span><span>{formatBalance(order.depositHeld)}</span>
		</li>
	</ul>

	<h2 class="section-title">Pagos</h2>
	{#if 0 === order.payments.length}
		<p class="note">Sin pagos todavía.</p>
	{:else}
		<ul class="payments">
			{#each order.payments as payment (payment.id)}
				<li class="payment">
					<div class="payment__head">
						<span>{CASH_CONCEPT_LABELS[payment.concept]}</span>
						<b>{formatSignedPesos(payment.amount)}</b>
					</div>
					<p class="meta payment__meta">{paymentMeta(payment)}</p>
					<Button variant="secondary" size="sm" inline href={receiptHref(payment)}>
						Imprimir recibo
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
</Screen>

{#if isDraft && data.confirmation}
	{@const confirmation = data.confirmation}
	<Modal bind:open={isConfirmOpen} title="Confirmar pedido #{order.id}">
		{#snippet body()}
			Anticipo sugerido: <b>{formatPesos(confirmation.suggestedAdvance)}</b>
		{/snippet}
		<form
			id="confirm"
			class="form-stack"
			method="POST"
			action="?/confirmar"
			use:enhance={closeOnSuccess(() => (isConfirmOpen = false))}
		>
			<p class="note">Solo de referencia: no hace falta un pago para confirmar.</p>
			<!-- Overbooking warns and never blocks: the order confirms anyway. -->
			{#if confirmation.shortages.length}
				<Notice tone="warning">
					Supera el inventario para esas fechas:
					{#each confirmation.shortages as shortage (shortage.productId)}
						<span class="shortage">{shortage.name}: faltan {shortage.short}</span>
					{/each}
					<span class="shortage">Puedes confirmar igual.</span>
				</Notice>
			{/if}
			{#if form?.confirmMessage}
				<Notice tone="error">{form.confirmMessage}</Notice>
			{/if}
		</form>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isConfirmOpen = false)}>
				Cancelar
			</Button>
			<Button type="submit" form="confirm" size="md">Confirmar</Button>
		{/snippet}
	</Modal>
{/if}

{#if canCancel}
	<Modal
		bind:open={isCancelOpen}
		title="Cancelar pedido #{order.id}"
		body="El pedido queda cancelado y solo de lectura; se pueden seguir registrando pagos. No se puede deshacer."
	>
		<form
			id="cancel"
			method="POST"
			action="?/cancelar"
			use:enhance={closeOnSuccess(() => (isCancelOpen = false))}
		>
			<Field label="Motivo" id="cancel-reason" error={form?.cancelMessage}>
				<textarea
					class="reason"
					id="cancel-reason"
					name="reason"
					rows="3"
					placeholder="Ej. El cliente aplazó el evento"
					aria-invalid={form?.cancelMessage ? 'true' : undefined}
					required
					bind:value={reason}></textarea>
			</Field>
		</form>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isCancelOpen = false)}>
				Volver
			</Button>
			<Button type="submit" form="cancel" size="md" disabled={'' === reason.trim()}>
				Cancelar pedido
			</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	p {
		margin: 0;
	}

	.badges {
		display: flex;
		flex: none;
		gap: var(--space-3);
	}

	.lead-notice {
		margin-bottom: var(--space-8);
	}

	.client {
		margin-bottom: var(--space-2);
	}

	.reach,
	.address {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		color: var(--link);
	}

	.reach > span,
	.address > span {
		color: var(--text-body);
	}

	.address {
		line-height: 1.35;
		text-align: left;
	}

	.address .meta {
		display: block;
		font-weight: var(--weight-regular);
	}

	.delivery-address {
		margin: var(--space-3) 0 var(--space-8);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-bottom: var(--space-11);
	}

	.actions__cancel :global(.btn) {
		color: var(--error-fg);
	}

	/* A desktop: every action side by side, sharing the row. */
	@container (width >= 1024px) {
		.actions {
			flex-direction: row;
		}

		.actions > :global(*) {
			flex: 1;
		}
	}

	.notes {
		font-size: var(--text-base);
		line-height: 1.4;
	}

	.notes + .section-title {
		margin-top: var(--space-9);
	}

	.detail-list .meta {
		display: block;
	}

	.deposit {
		margin-top: var(--space-4);
	}

	.payments {
		padding: 0;
		margin: 0;
		list-style: none;
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.payment {
		padding: var(--space-6) 0;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.payment__meta {
		margin: var(--space-1) 0 var(--space-4);
	}

	.payment__head {
		display: flex;
		gap: var(--space-6);
		justify-content: space-between;
		font-size: var(--text-base);
	}

	.shortage {
		display: block;
		margin-top: var(--space-2);
	}

	.reason {
		box-sizing: border-box;
		width: 100%;
		padding: var(--space-6) var(--space-7);
		margin: 0;
		font: var(--type-input);
		color: var(--text-body);
		resize: vertical;
		outline: none;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-input);
	}

	.reason:focus-visible {
		border-color: var(--border-strong);
	}
</style>
