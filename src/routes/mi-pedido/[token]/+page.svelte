<script lang="ts">
	import Badge, { ORDER_STATUS_TONES } from '$lib/components/Badge.svelte';
	import { formatLongDay } from '$lib/datetime';
	import { formatBalance, formatPesos } from '$lib/format';
	import {
		CLIENT_DELIVERY_METHOD_LABELS,
		CLIENT_RETURN_METHOD_LABELS,
		ORDER_STATUS_LABELS
	} from '$lib/labels';
	import type { PageProps } from './$types';

	// «Su pedido»: the order as the client holds it on paper, read-only. The event's date only,
	// never the trips' or times; the method as the client sees it, never who carries it; the
	// printout's figures; the terms and conditions last.
	let { data }: PageProps = $props();

	const order = $derived(data.order);
	const credit = $derived(-order.balanceDue);
</script>

<svelte:head>
	<title>Pedido #{order.id} · Banquetes Consuelo C</title>
</svelte:head>

<div class="order-head">
	<h1 class="order-head__title">Pedido #{order.id}</h1>
	<Badge tone={ORDER_STATUS_TONES[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
</div>
<p class="order-client">{order.clientName}</p>

<h2 class="section-title">Evento</h2>
<ul class="detail-list">
	<li><span>Fecha del evento</span><span>{formatLongDay(order.eventDate)}</span></li>
</ul>

<div class="trips">
	<div>
		<h2 class="section-title">Entrega</h2>
		<ul class="detail-list">
			<li class="detail-list__row--plain">
				<span>Dirección</span>
				<span>
					{order.delivery.address_1}
					{#if order.delivery.address_2}<span class="meta">{order.delivery.address_2}</span>{/if}
				</span>
			</li>
			<li class="detail-list__row--plain">
				<span>Forma de entrega</span>
				<span>{CLIENT_DELIVERY_METHOD_LABELS[order.delivery.method]}</span>
			</li>
		</ul>
	</div>
	<div>
		<h2 class="section-title">Recogida</h2>
		<ul class="detail-list">
			<li class="detail-list__row--plain">
				<span>Forma de recogida</span>
				<span>{CLIENT_RETURN_METHOD_LABELS[order.pickup.method]}</span>
			</li>
		</ul>
	</div>
</div>

<h2 class="section-title">Productos ({order.items.length})</h2>
<p class="meta rental-days">Días cobrados: {order.rentalDays}</p>
<ul class="detail-list">
	{#each order.items as item, index (index)}
		<li>
			<span>
				{item.qty} × {item.name}
				<span class="meta">
					{formatPesos(item.unit_price)} c/u · {order.rentalDays}
					{1 === order.rentalDays ? 'día' : 'días'}
				</span>
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
	{#if order.discount}
		<li class="detail-list__row--plain">
			<span>Descuento</span><span>−{formatPesos(order.discount)}</span>
		</li>
	{/if}
	<li class="detail-list__row--plain">
		<span>Transporte</span><span>{formatPesos(order.transportCost)}</span>
	</li>
	<li class="detail-list__row--strong">
		<span>Total</span><span>{formatPesos(order.orderTotal)}</span>
	</li>
	<li class="detail-list__row--plain">
		<span>Depósito</span><span>{formatPesos(order.depositAmount)}</span>
	</li>
	<li class="detail-list__row--plain">
		<span>Pagado</span><span>{formatBalance(order.paid)}</span>
	</li>
	{#if credit > 0}
		<li class="detail-list__row--strong">
			<span>Saldo a su favor</span><span class="credit">{formatPesos(credit)}</span>
		</li>
	{:else}
		<li class="detail-list__row--strong">
			<span>Saldo</span><span>{formatPesos(order.balanceDue)}</span>
		</li>
	{/if}
</ul>
{#if credit > 0}
	<p class="note credit-note">Pagó {formatPesos(credit)} más del total del pedido.</p>
{/if}

{#if data.terms}
	<h2 class="section-title terms-title">Términos y condiciones</h2>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderTerms' output: raw HTML escaped, links and images filtered -->
	<div class="prose terms">{@html data.terms}</div>
{/if}

<style>
	.order-head {
		display: flex;
		gap: var(--space-6);
		align-items: center;
		justify-content: space-between;
		margin-top: 36px;
	}

	.order-head__title {
		margin: 0;
		font-size: var(--text-3xl);
		font-weight: var(--weight-bold);
	}

	.order-client {
		margin: var(--space-2) 0 var(--section-gap);
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}

	.detail-list .meta {
		display: block;
	}

	.trips > div,
	.trips + .section-title {
		margin-top: var(--space-9);
	}

	.rental-days {
		margin: calc(-1 * var(--space-2)) 0 var(--space-4);
	}

	.credit {
		color: var(--success-fg);
	}

	.credit-note {
		margin-top: var(--space-4);
	}

	.terms-title {
		margin-top: var(--space-9);
	}

	/* The rule under the section title, like a detail list's; the fine print a step smaller. */
	.terms {
		padding-top: var(--space-6);
		font-size: var(--text-sm);
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.terms :global(h2) {
		font-size: var(--text-md);
	}

	.terms :global(h3) {
		font-size: var(--text-sm);
	}

	@container (width >= 1024px) {
		.order-head {
			margin-top: 44px;
		}

		.order-head__title {
			font-size: 24px;
		}

		.trips {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			gap: 0 var(--space-14);
		}
	}
</style>
