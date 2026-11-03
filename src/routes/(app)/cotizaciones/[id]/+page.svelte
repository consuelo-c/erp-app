<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge, { QUOTE_STATE_TONES } from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatLongDay, getInstantDate } from '$lib/datetime';
	import { formatPesos, formatShare } from '$lib/format';
	import { QUOTE_STATE_LABELS } from '$lib/labels';
	import { formatPhone } from '$lib/phone';
	import type { PageProps } from './$types';

	// The order detail's order without its trips or its money: client, event, validity, notes,
	// products, totals. While it's open, valid or expired, it can be edited and converted.
	let { data }: PageProps = $props();

	const quote = $derived(data.quote);
	const id = $derived(String(quote.id));
	const isOpen = $derived('CONVERTED' !== quote.state);
</script>

<svelte:head>
	<title>Cotización #{quote.id} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Cotización #{quote.id}" backHref={resolve('/cotizaciones')}>
			<Badge tone={QUOTE_STATE_TONES[quote.state]}>{QUOTE_STATE_LABELS[quote.state]}</Badge>
		</ScreenHeader>
	{/snippet}

	<!-- Set by the quote form's redirect after a save. -->
	{#if page.url.searchParams.has('guardado')}
		<div class="lead-notice"><Notice tone="success">Cotización guardada con éxito</Notice></div>
	{/if}

	{#if null !== quote.orderId}
		<div class="lead-notice">
			<Notice tone="info">
				Convertida en el pedido
				<a href={resolve('/(app)/pedidos/[id]', { id: String(quote.orderId) })}>#{quote.orderId}</a>
			</Notice>
		</div>
	{/if}

	<h2 class="section-title client">{quote.client.name}</h2>
	<div class="reach">
		<span>{formatPhone(quote.client.phone)}</span>
		<IconButton
			icon="phone"
			size="lg"
			label="Llamar a {quote.client.name}"
			href="tel:+{quote.client.phone}"
		/>
		<IconButton
			icon="whatsapp"
			size="lg"
			label="Escribir por WhatsApp a {quote.client.name}"
			href="https://wa.me/{quote.client.phone}"
			target="_blank"
			rel="noopener"
		/>
	</div>

	<h2 class="section-title">Evento</h2>
	<ul class="detail-list">
		<li>
			<span>Fecha del evento</span>
			<span>{null === quote.eventDate ? 'Sin fecha' : formatLongDay(quote.eventDate)}</span>
		</li>
		{#if quote.address1}
			<li class="detail-list__row--plain">
				<span>Lugar del evento</span>
				<span class="place">
					<a
						href="https://www.google.com/maps/search/?api=1&query={encodeURIComponent(
							quote.address1
						)}"
						target="_blank"
						rel="noopener">{quote.address1}</a
					>
					{#if quote.address2}<span class="meta">{quote.address2}</span>{/if}
				</span>
			</li>
		{/if}
		<li class="detail-list__row--plain">
			<span>Días cobrados</span><span>{quote.rentalDays}</span>
		</li>
	</ul>

	<h2 class="section-title">Vigencia</h2>
	<ul class="detail-list">
		<li class="detail-list__row--plain">
			<span>Fecha</span><span>{formatLongDay(getInstantDate(quote.createdAt))}</span>
		</li>
		<li><span>Válida hasta</span><span>{formatLongDay(quote.validUntil)}</span></li>
	</ul>

	{#if quote.notes}
		<h2 class="section-title">Notas</h2>
		<p class="notes">{quote.notes}</p>
	{/if}

	<h2 class="section-title">Productos ({quote.items.length})</h2>
	<ul class="detail-list">
		{#each quote.items as item (item.product_id)}
			<li>
				<span>
					{item.qty} × {item.name}
					<span class="meta"
						>Lista {formatPesos(item.list_price)} · Cobrado {formatPesos(item.unit_price)}</span
					>
					<!-- It stays on the quote and on the order converting it makes; only «Duplicar» drops it. -->
					{#if quote.inactiveProductIds.includes(item.product_id)}
						<span class="meta">Producto inactivo</span>
					{/if}
				</span>
				<span>{formatPesos(item.line_total)}</span>
			</li>
		{/each}
	</ul>

	<h2 class="section-title">Totales</h2>
	<ul class="detail-list">
		<li class="detail-list__row--plain">
			<span>Subtotal</span><span>{formatPesos(quote.itemsTotal)}</span>
		</li>
		<li class="detail-list__row--plain">
			{#if 0 === quote.discount}
				<span>Descuento</span><span>{formatPesos(0)}</span>
			{:else}
				<span>Descuento ({formatShare(quote.discount, quote.itemsTotal)})</span>
				<span>−{formatPesos(quote.discount)}</span>
			{/if}
		</li>
		<li class="detail-list__row--plain">
			<span>Transporte</span>
			<span>{null === quote.transportCost ? 'Por acordar' : formatPesos(quote.transportCost)}</span>
		</li>
		<li class="detail-list__row--strong">
			<span>{null === quote.transportCost ? 'Total sin transporte' : 'Total'}</span>
			<span>{formatPesos(quote.quoteTotal)}</span>
		</li>
	</ul>

	<!-- «Convertir en pedido», the main one, last. -->
	<div class="screen__action">
		{#if isOpen}
			<Button variant="secondary" href={resolve('/(app)/cotizaciones/[id]/editar', { id })}>
				Editar
			</Button>
		{/if}
		<Button variant="secondary" href="{resolve('/cotizaciones/nueva')}?desde={id}">Duplicar</Button>
		<Button variant="secondary" href={resolve('/(app)/cotizaciones/[id]/impresion', { id })}>
			Imprimir
		</Button>
		<Button variant="secondary" href={resolve('/(app)/cotizaciones/[id]/historial', { id })}>
			Historial
		</Button>
		{#if isOpen}
			<Button href="{resolve('/pedidos/nuevo')}?cotizacion={id}">Convertir en pedido</Button>
		{/if}
	</div>
</Screen>

<style>
	p {
		margin: 0;
	}

	.lead-notice {
		margin-bottom: var(--space-8);
	}

	.client {
		margin-bottom: var(--space-2);
	}

	/* 24px apart: each icon's 48px hit area overhangs its glyph by 11px on either side. */
	.reach {
		display: flex;
		gap: var(--space-12);
		align-items: center;
		margin-bottom: var(--space-11);
		color: var(--link);
	}

	.reach > span {
		color: var(--text-body);
	}

	.place {
		text-align: right;
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
</style>
