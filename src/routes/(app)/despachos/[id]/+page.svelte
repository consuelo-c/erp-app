<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge, { ORDER_STATUS_TONES } from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatClockTime, formatLongDay, formatShortDay } from '$lib/datetime';
	import { formatBalance, formatPesos } from '$lib/format';
	import { DELIVERY_METHOD_LABELS, ORDER_STATUS_LABELS, RETURN_METHOD_LABELS } from '$lib/labels';
	import { formatPhone } from '$lib/phone';
	import type { Carrier } from '$lib/server/services/orders';
	import type { PageProps } from './$types';

	// The order as the warehouse and the driver work it: who, where, when, what, and its money.
	// Read-only: no commercial action lives here. Every control is 48px, for a phone in the street.
	let { data }: PageProps = $props();

	const order = $derived(data.order);
	const delivery = $derived(order.delivery);
	const pickup = $derived(order.pickup);
	const id = $derived(String(order.id));

	// The day the order was opened from (`?fecha=`): «Atrás» goes back to it, through the printout,
	// the timeline and the orders linked here. Without one, Despachos opens on today.
	const backHref = $derived(`${resolve('/despachos')}${page.url.search}`);

	function keepOrigin(href: string): string {
		return `${href}${page.url.search}`;
	}

	function orderHref(orderId: number): string {
		return keepOrigin(resolve('/(app)/despachos/[id]', { id: String(orderId) }));
	}

	// The pickup address only when the products come back from somewhere else.
	const isPickupElsewhere = $derived(
		delivery.address_1 !== pickup.address_1 || delivery.address_2 !== pickup.address_2
	);
	const notes = $derived(
		[
			{ label: 'Nota de entrega', text: delivery.notes },
			{ label: 'Nota de recogida', text: pickup.notes },
			{ label: 'Notas del pedido', text: order.notes }
		].filter((note) => null !== note.text)
	);
	const days = $derived(`${order.rentalDays} ${1 === order.rentalDays ? 'día' : 'días'}`);

	function tripWhen(date: string, time: string | null): string {
		return null === time
			? formatShortDay(date)
			: `${formatShortDay(date)} · ${formatClockTime(time)}`;
	}

	function mapsHref(address: string): string {
		return `https://www.google.com/maps/search/?api=1&${new URLSearchParams({ query: address })}`;
	}
</script>

<svelte:head>
	<title>Pedido #{order.id} · Despachos · Banquetes Consuelo C</title>
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
			size="lg"
			label="Abrir en Google Maps"
			href={mapsHref(line1)}
			target="_blank"
			rel="noopener"
		/>
	</span>
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader title="Pedido #{order.id}" {backHref}>
			<span class="badges">
				<Badge tone={ORDER_STATUS_TONES[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
				{#if order.hasIncident}
					<Badge tone="error">Con novedad</Badge>
				{/if}
			</span>
		</ScreenHeader>
	{/snippet}

	<h2 class="section-title client">{order.client.name}</h2>
	<div class="reach">
		<span>{formatPhone(order.client.phone)}</span>
		<IconButton
			icon="phone"
			size="lg"
			label="Llamar a {order.client.name}"
			href="tel:+{order.client.phone}"
		/>
		<IconButton
			icon="whatsapp"
			size="lg"
			label="Escribir por WhatsApp a {order.client.name}"
			href="https://wa.me/{order.client.phone}"
			target="_blank"
			rel="noopener"
		/>
	</div>
	<div class="delivery-address">{@render address(delivery.address_1, delivery.address_2)}</div>

	{#if order.parentOrderId}
		<div class="lead-notice">
			<Notice tone="info">
				Extensión del pedido
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- orderHref() builds it with resolve() -->
				<a href={orderHref(order.parentOrderId)}>#{order.parentOrderId}</a>
			</Notice>
		</div>
	{/if}

	{#each order.extensions as extension (extension.id)}
		<div class="lead-notice">
			<Notice tone="info">
				Sigue en el pedido
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- orderHref() builds it with resolve() -->
				<a href={orderHref(extension.id)}>#{extension.id}</a>
			</Notice>
		</div>
	{/each}

	<h2 class="section-title">Evento</h2>
	<ul class="detail-list">
		<li><span>Fecha del evento</span><span>{formatLongDay(order.eventDate)}</span></li>
	</ul>

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

	{#if notes.length}
		<h2 class="section-title">Notas</h2>
		<div class="notes">
			{#each notes as note (note.label)}
				<div>
					<div class="notes__label">{note.label}</div>
					<p class="notes__text">{note.text}</p>
				</div>
			{/each}
		</div>
	{/if}

	<h2 class="section-title">Productos ({order.items.length})</h2>
	<ul class="detail-list">
		{#each order.items as item (item.product_id)}
			<li>
				<span>
					{item.qty} × {item.name}
					<span class="meta">{formatPesos(item.unit_price)} c/u · {days}</span>
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
		<li class="detail-list__row--plain">
			<span>Depósito acordado</span><span>{formatPesos(order.depositAmount)}</span>
		</li>
		<li class="detail-list__row--plain">
			<span>Depósito recibido</span><span>{formatBalance(order.depositHeld)}</span>
		</li>
	</ul>
	<!-- The driver doesn't collect: a balance informs and blocks nothing. -->
	{#if 0 < order.balanceDue}
		<p class="note balance-note">Saldo pendiente. No impide entregar.</p>
	{/if}

	<div class="actions">
		<Button
			variant="secondary"
			href={keepOrigin(resolve('/(app)/despachos/[id]/impresion', { id }))}
		>
			Imprimir pedido
		</Button>
		<Button
			variant="secondary"
			href={keepOrigin(resolve('/(app)/despachos/[id]/historial', { id }))}
		>
			Historial
		</Button>
	</div>
</Screen>

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

	.reach > span {
		font-size: var(--text-base);
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

	.notes {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		padding-top: var(--space-6);
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.notes__label {
		font: var(--type-label);
		color: var(--text-secondary);
	}

	.notes__text {
		margin-top: var(--space-1);
		font-size: var(--text-base);
		line-height: 1.4;
	}

	.notes + .section-title {
		margin-top: var(--space-9);
	}

	.detail-list .meta {
		display: block;
	}

	.balance-note {
		margin-top: var(--space-4);
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-5);
		margin-top: var(--space-11);
	}
</style>
