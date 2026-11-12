<script lang="ts">
	import { formatClockTime, formatLongDay, formatShortDay } from '$lib/datetime';
	import { formatBalance, formatPesos } from '$lib/format';
	import { readReceivableBalance } from '$lib/orders';
	import type { OrderPrintout } from '$lib/server/services/orders';
	import { printedContact } from '$lib/whatsapp';
	import HalfLetterPrintout from './HalfLetterPrintout.svelte';

	// The half-letter sheets the client signs on receiving the order: the client's data opens the
	// first, the totals and the signature close the last. Pedidos and Despachos print it, each going
	// back to its own detail.
	let { printout, backHref }: { printout: OrderPrintout; backHref: string } = $props();

	const { order, company } = $derived(printout);
	const delivery = $derived(order.delivery);
	const pickup = $derived(order.pickup);
	const receivable = $derived(readReceivableBalance(order));
	const contact = $derived(printedContact(order.client.phone, order.client.whatsapp));
	// The pickup address only when the products come back from somewhere else.
	const isPickupElsewhere = $derived(
		delivery.address_1 !== pickup.address_1 || delivery.address_2 !== pickup.address_2
	);

	function tripWhen(date: string, time: string | null): string {
		return null === time
			? formatShortDay(date)
			: `${formatShortDay(date)}, ${formatClockTime(time)}`;
	}
</script>

{#snippet address(line1: string, line2: string | null)}
	<span>
		{line1}
		{#if line2}<br />{line2}{/if}
	</span>
{/snippet}

{#snippet opening()}
	<div class="print-row"><span>Cliente</span><span>{order.client.name}</span></div>
	<div class="print-row">
		<span>{contact.label}</span><span>{contact.value}</span>
	</div>
	<div class="print-row">
		<span>Dirección de entrega</span>
		{#if 'CLIENT_PICKUP' === delivery.method}
			<span>Recoge el cliente en la bodega</span>
		{:else}
			{@render address(delivery.address_1, delivery.address_2)}
		{/if}
	</div>
	{#if 'CLIENT_RETURN' === pickup.method}
		<div class="print-row">
			<span>Dirección de recogida</span><span>Devuelve el cliente en la bodega</span>
		</div>
	{:else if isPickupElsewhere}
		<div class="print-row">
			<span>Dirección de recogida</span>
			{@render address(pickup.address_1, pickup.address_2)}
		</div>
	{/if}

	<div class="print-group">
		<div class="print-row">
			<span>Evento</span><span>{formatLongDay(order.eventDate)}</span>
		</div>
		<div class="print-row">
			<span>Entrega</span><span>{tripWhen(order.deliveryDate, delivery.time)}</span>
		</div>
		<div class="print-row">
			<span>Recogida</span><span>{tripWhen(order.pickupDate, pickup.time)}</span>
		</div>
		<div class="print-row"><span>Días cobrados</span><span>{order.rentalDays}</span></div>
	</div>
{/snippet}

{#snippet closing()}
	<div class="print-row">
		<span>Subtotal</span><span>{formatPesos(order.itemsTotal)}</span>
	</div>
	<div class="print-row">
		<span>Descuento</span>
		<span>{0 === order.discount ? formatPesos(0) : `−${formatPesos(order.discount)}`}</span>
	</div>
	<div class="print-row">
		<span>Transporte</span><span>{formatPesos(order.transportCost)}</span>
	</div>
	<div class="print-row print-row--strong print-total">
		<span>Total</span><span>{formatPesos(order.orderTotal)}</span>
	</div>
	<div class="print-row">
		<span>Depósito</span><span>{formatPesos(order.depositAmount)}</span>
	</div>
	{#if null === receivable}
		<div class="print-row"><span>Pagado</span><span>{formatBalance(order.paid)}</span></div>
		<div class="print-row print-row--strong">
			<span>Saldo</span><span>{formatBalance(order.balanceDue)}</span>
		</div>
	{:else}
		<div class="print-row print-row--strong">
			<span>{receivable.label}</span><span>{receivable.amount}</span>
		</div>
		{#if receivable.credit > 0}
			<div class="print-row">
				<span>Saldo a favor</span><span>{formatPesos(receivable.credit)}</span>
			</div>
		{/if}
	{/if}

	<!-- The client's proof of receipt: never sacrificed for space. -->
	<div class="signature">Recibí: Nombre / C.C. / NIT</div>
{/snippet}

<HalfLetterPrintout
	title="Pedido #{order.id}"
	{company}
	items={order.items}
	back={{ href: backHref, label: 'Volver al pedido' }}
	{opening}
	{closing}
/>

<style>
	.signature {
		flex: none;
		width: 62%;
		padding-top: var(--space-2);
		margin-top: 48px;
		font-size: var(--print-sm);
		color: var(--text-secondary);
		border-top: var(--border-w-hair) solid var(--border-strong);
	}
</style>
