<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge, { ORDER_STATUS_TONES } from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Field from '$lib/components/Field.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatClockTime, formatInstant, formatLongDay, formatShortDay } from '$lib/datetime';
	import { formatBalance, formatPesos } from '$lib/format';
	import {
		CASH_CONCEPT_LABELS,
		DELIVERY_METHOD_LABELS,
		ORDER_STATUS_LABELS,
		RESPONSIBLE_PARTY_LABELS,
		RETURN_METHOD_LABELS
	} from '$lib/labels';
	import {
		isCancelledOnItsWay,
		isEditableStatus,
		isLegalTransition,
		readOwedOnReceivable,
		readReceivableBalance
	} from '$lib/orders';
	import type { Incident, ResponsibleParty } from '$lib/server/services/incidents';
	import type { Carrier } from '$lib/server/services/orders';
	import { singleReach } from '$lib/whatsapp';
	import IncidentCards from '../../IncidentCards.svelte';
	import PaymentList from '../../PaymentList.svelte';
	import ReachLines from '../../ReachLines.svelte';
	import type { PageProps } from './$types';

	// The order as everyone at the office reads it: who, where, when, what, and its money. The
	// actions follow its state; an outstanding balance is shown, never treated as an error.
	let { data, form }: PageProps = $props();

	const order = $derived(data.order);
	const delivery = $derived(order.delivery);
	const pickup = $derived(order.pickup);
	const receivable = $derived(readReceivableBalance(order));
	// Cancelled and billed: what the company holds for the client is its cuenta's credit.
	const owedOnReceivable = $derived(readOwedOnReceivable(order));

	const canRecordPayment = $derived(0 < data.paymentConcepts.length);
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

	// Paying is the usual next step while there's a balance.
	const isPaymentNext = $derived(data.paymentConcepts.includes('INSTALLMENT'));

	// The save's notices belong to the redirect that brought them: kept for this view, then taken
	// off the URL, so a reload or «Atrás» back to it shows neither.
	let keptSave = $state<string | null>(null);
	afterNavigate(({ to }) => {
		keptSave = to?.url.searchParams.get('guardado') ?? null;
		if (null !== keptSave) {
			replaceState(resolve('/(app)/pedidos/[id]', { id: String(order.id) }), {});
		}
	});
	const savedNotice = $derived(page.url.searchParams.get('guardado') ?? keptSave);

	// A salesperson who typed the transport and the deposit may think they were recorded as paid.
	const isJustCreated = $derived('nuevo' === savedNotice);
	const amountsNotPayments = $derived(
		0 === order.depositAmount
			? 'El transporte y el total son lo que se le cobra al cliente, no pagos recibidos. Registra el pago con «Registrar pago».'
			: 'El transporte, el depósito y el total son lo que se le cobra al cliente, no pagos recibidos. Registra con «Registrar pago» el pago del pedido y, aparte, el depósito de garantía.'
	);

	// Set by the payment entry's redirect: the payment just recorded, its receipt next.
	const recordedPayment = $derived(
		order.payments.find((payment) => String(payment.id) === page.url.searchParams.get('pago'))
	);

	// «Novedades»: whose fault one incident was, in its own dialog; reversing is the cards'.
	let selected = $state<Incident | null>(null);
	let isAssignOpen = $state(false);
	let party = $state<ResponsibleParty>('UNDETERMINED');
	const parties = Object.entries(RESPONSIBLE_PARTY_LABELS) as [ResponsibleParty, string][];

	function startAssign(incident: Incident) {
		selected = incident;
		party = incident.responsibleParty;
		isAssignOpen = true;
	}

	// «Copiar enlace del cliente»: the link is copied, never shown; the notice clears itself.
	let copyNotice = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyClientLink(token: string) {
		const link = new URL(resolve('/mi-pedido/[token]', { token }), page.url.origin);
		try {
			await navigator.clipboard.writeText(link.href);
			copyNotice = 'Enlace copiado';
		} catch {
			copyNotice = 'No se pudo copiar el enlace';
		}
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copyNotice = null), 3000);
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
	{@const reach = singleReach(carrier.phone, carrier.whatsapp)}
	<li class="detail-list__row--plain">
		<span>Transportador</span>
		<span
			>{carrier.name}{#if reach}
				·
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external wa.me link -->
				<a href={reach.href}>{reach.text}</a>{/if}</span
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
			size="lg"
			label="Abrir en Google Maps"
			href={mapsHref(line1)}
			target="_blank"
			rel="noopener"
		/>
	</span>
{/snippet}

{#snippet receivableLink(id: number, text: string)}
	<a href={resolve('/(app)/cuentas-de-cobro/[id]', { id: String(id) })}>{text}</a>
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader title="Pedido #{order.id}" backHref={resolve('/pedidos')}>
			{#snippet actions()}
				<IconButton
					icon="printer"
					label="Imprimir"
					href={resolve('/(app)/pedidos/[id]/impresion', { id: String(order.id) })}
				/>
				<IconButton
					icon="file"
					label="Historial"
					href={resolve('/(app)/pedidos/[id]/historial', { id: String(order.id) })}
				/>
				{#if data.publicToken}
					{@const token = data.publicToken}
					<IconButton
						icon="copy"
						label="Copiar enlace del cliente"
						onclick={() => copyClientLink(token)}
					/>
				{/if}
				<!-- A cancelled order is never delivered: Despachos has nothing to do with it, unless it was
				     cancelled on its way and came back, maybe damaged. -->
				{#if 'CANCELLED' !== order.status || isCancelledOnItsWay(order.cancellation)}
					<IconButton
						icon="truck"
						label="Ver en Despachos"
						href={resolve('/(app)/despachos/[id]', { id: String(order.id) })}
					/>
				{/if}
			{/snippet}
			<span class="badges">
				<Badge tone={ORDER_STATUS_TONES[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
				{#if order.hasIncident}
					<Badge tone="error">Con novedad</Badge>
				{/if}
			</span>
		</ScreenHeader>
	{/snippet}

	<!-- Set by the order form's redirect after a save; `nuevo` when it created the order. -->
	{#if null !== savedNotice}
		<div class="lead-notice saved">
			<Notice tone="success">Pedido guardado con éxito</Notice>
			{#if isJustCreated}
				<Notice tone="info">{amountsNotPayments}</Notice>
			{/if}
		</div>
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

	{#if data.quoteId}
		<div class="lead-notice">
			<Notice tone="info">
				Desde la cotización
				<a href={resolve('/(app)/cotizaciones/[id]', { id: String(data.quoteId) })}
					>#{data.quoteId}</a
				>
			</Notice>
		</div>
	{/if}

	{#if receivable}
		<div class="lead-notice">
			<Notice tone="info">
				{@render receivableLink(receivable.id, `Cuenta de cobro Nº ${receivable.id}`)}
			</Notice>
		</div>
	{/if}

	{#if order.cancellation}
		<div class="lead-notice">
			<Notice tone="info">
				Cancelado el {formatInstant(order.cancellation.cancelledAt)} por {order.cancellation
					.cancelledBy}: {order.cancellation.reason}. Se pueden seguir registrando pagos.
			</Notice>
		</div>
	{/if}

	<h2 class="section-title client">{order.client.name}</h2>
	<div class="reach">
		<ReachLines phone={order.client.phone} whatsapp={order.client.whatsapp} />
	</div>
	<div class="delivery-address">{@render address(delivery.address_1, delivery.address_2)}</div>

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
		{#if null === receivable}
			<li class="detail-list__row--plain">
				<span>Pagado</span><span>{formatBalance(order.paid)}</span>
			</li>
			<!-- Cancelled, nothing is delivered: what's left is what the company holds for the client. -->
			{#if 'CANCELLED' === order.status}
				<li class="detail-list__row--strong">
					<span>A favor del cliente</span><span>{formatPesos(order.owedToClient)}</span>
				</li>
			{:else}
				<li class="detail-list__row--strong">
					<span>Saldo</span><span>{formatBalance(order.balanceDue)}</span>
				</li>
			{/if}
		{:else if owedOnReceivable}
			<li class="detail-list__row--strong">
				<span>{owedOnReceivable.label}</span><span>{owedOnReceivable.amount}</span>
			</li>
		{/if}
		<li class="detail-list__row--plain deposit">
			<span>Depósito acordado</span><span>{formatPesos(order.depositAmount)}</span>
		</li>
		<li class="detail-list__row--plain">
			<span>Depósito recibido</span><span>{formatBalance(order.depositHeld)}</span>
		</li>
	</ul>

	{#if data.incidents.length}
		<h2 class="section-title" id="novedades">Novedades ({data.incidents.length})</h2>
		<p class="meta incidents__money">
			Depósito recibido {formatBalance(order.depositHeld)} ·
			{receivable?.text ?? `Saldo ${formatBalance(order.balanceDue)}`}
		</p>
		<IncidentCards
			incidents={data.incidents}
			correctHref={(incident) =>
				resolve('/(app)/despachos/[id]/novedad/[incidentId]', {
					id: String(order.id),
					incidentId: String(incident.id)
				})}
			reverseMessage={form?.reverseMessage}
			buttonSize="sm"
			onassign={startAssign}
		/>
	{/if}

	<h2 class="section-title">Pagos</h2>
	<PaymentList payments={order.payments} />
	{#if receivable}
		<p class="receivable-balance">
			{@render receivableLink(receivable.id, owedOnReceivable?.text ?? receivable.text)}
		</p>
	{/if}

	<!-- Payments are recorded in any state, a cancelled order's refunds included. -->
	<div class="screen__action">
		{#if canEdit}
			<Button
				variant="secondary"
				href={resolve('/(app)/pedidos/[id]/editar', { id: String(order.id) })}
			>
				Editar
			</Button>
		{/if}
		<!-- Products already at the client's, kept for more days: a new order. -->
		{#if 'DELIVERED' === order.status}
			<Button
				variant="secondary"
				href={resolve('/(app)/pedidos/[id]/extension', { id: String(order.id) })}
			>
				Crear extensión
			</Button>
		{/if}
		{#if canCancel}
			<span class="actions__cancel">
				<Button variant="secondary" onclick={startCancel}>Cancelar pedido</Button>
			</span>
		{/if}
		<!-- In any state: a cancelled order booked again, or a past event repeated, is a new quote. -->
		<Button variant="secondary" href="{resolve('/(app)/cotizaciones/nueva')}?pedido={order.id}">
			Cotizar de nuevo
		</Button>
		{#if data.canIssueReceivable}
			<Button
				variant="secondary"
				href="{resolve('/(app)/cuentas-de-cobro/nueva')}?pedido={order.id}"
			>
				Emitir cuenta de cobro
			</Button>
		{/if}
		{#if canRecordPayment}
			<Button
				variant={isPaymentNext ? 'primary' : 'secondary'}
				href={resolve('/(app)/pedidos/[id]/pago', { id: String(order.id) })}
			>
				Registrar pago
			</Button>
		{/if}
	</div>

	{#if copyNotice}
		<p class="copy-notice" role="status">{copyNotice}</p>
	{/if}
</Screen>

{#if canCancel}
	<Modal
		bind:open={isCancelOpen}
		title="Cancelar pedido #{order.id}"
		body="El pedido queda cancelado y solo de lectura; se pueden seguir registrando pagos. Para reservarlo otra vez, «Cotizar de nuevo»."
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

{#if selected}
	{@const incident = selected}
	<Modal bind:open={isAssignOpen} title="Responsable de la novedad">
		{#snippet body()}
			Depósito recibido <b>{formatBalance(order.depositHeld)}</b> ·
			{#if receivable}<b>{receivable.text}</b>{:else}Saldo
				<b>{formatBalance(order.balanceDue)}</b>{/if}. Si no fue el cliente, el depósito no se
			retiene.
		{/snippet}
		<form
			id="assign"
			class="form-stack"
			method="POST"
			action="?/responsable"
			use:enhance={closeOnSuccess(() => (isAssignOpen = false))}
		>
			<input type="hidden" name="id" value={incident.id} />
			<div class="chip-row" role="radiogroup" aria-label="Responsable">
				{#each parties as [value, label] (value)}
					<Chip
						type="radio"
						name="responsible_party"
						{value}
						{label}
						checked={party === value}
						onchange={() => (party = value)}
					/>
				{/each}
			</div>
			{#if form?.assignMessage}
				<Notice tone="error">{form.assignMessage}</Notice>
			{/if}
		</form>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isAssignOpen = false)}>
				Cancelar
			</Button>
			<Button type="submit" form="assign" size="md">Guardar</Button>
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

	.saved {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.client {
		margin-bottom: var(--space-2);
	}

	.address {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		line-height: 1.35;
		color: var(--link);
		text-align: left;
	}

	.address > span {
		color: var(--text-body);
	}

	.address .meta {
		display: block;
		font-weight: var(--weight-regular);
	}

	.delivery-address {
		margin: var(--space-3) 0 var(--space-11);
	}

	.actions__cancel :global(.btn) {
		color: var(--error-fg);
	}

	/* Sticks to the bottom of the scrolling body, above the bottom bar, wherever it's scrolled. */
	.copy-notice {
		position: sticky;
		bottom: 0;
		padding: var(--space-6) var(--space-7);
		margin-top: var(--space-8);
		font: var(--weight-semibold) var(--text-base) / 1.3 var(--font-sans);
		color: var(--surface-card);
		text-align: center;
		background: var(--text-body);
		border-radius: var(--radius-input);
		box-shadow: var(--shadow-dialog);
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

	.receivable-balance {
		margin: var(--space-5) 0 0;
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
	}

	.deposit {
		margin-top: var(--space-4);
	}

	.incidents__money {
		margin-bottom: var(--space-6);
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
