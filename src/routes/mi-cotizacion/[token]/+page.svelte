<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { formatLongDay } from '$lib/datetime';
	import { formatPesos } from '$lib/format';
	import type { PageProps } from './$types';

	// «Su cotización»: the quote as the client holds it on paper, read-only, with the printout's
	// figures. The client answers with one of two WhatsApp links, which write nothing; the terms and
	// conditions last, read before confirming.
	let { data }: PageProps = $props();

	const quote = $derived(data.quote);
	const isTransportPending = $derived(null === quote.transportCost);
</script>

<svelte:head>
	<title>Cotización #{quote.id} · Banquetes Consuelo C</title>
</svelte:head>

<h1 class="quote-title">Cotización #{quote.id}</h1>
<p class="quote-client">{quote.clientName}</p>

<ul class="detail-list">
	<li class="detail-list__row--plain">
		<span>Fecha</span><span>{formatLongDay(quote.createdOn)}</span>
	</li>
	<li><span>Válida hasta</span><span>{formatLongDay(quote.validUntil)}</span></li>
</ul>

{#if quote.eventDate || quote.address1}
	<h2 class="section-title">Evento</h2>
	<ul class="detail-list">
		{#if quote.eventDate}
			<li><span>Fecha del evento</span><span>{formatLongDay(quote.eventDate)}</span></li>
		{/if}
		{#if quote.address1}
			<li class="detail-list__row--plain">
				<span>Lugar del evento</span>
				<span>
					{quote.address1}
					{#if quote.address2}<span class="meta">{quote.address2}</span>{/if}
				</span>
			</li>
		{/if}
	</ul>
{/if}

<h2 class="section-title">Productos ({quote.items.length})</h2>
<p class="meta rental-days">Días cobrados: {quote.rentalDays}</p>
<ul class="detail-list">
	{#each quote.items as item, index (index)}
		<li>
			<span>
				{item.qty} × {item.name}
				<span class="meta">
					{formatPesos(item.unit_price)} c/u · {quote.rentalDays}
					{1 === quote.rentalDays ? 'día' : 'días'}
				</span>
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
	{#if quote.discount}
		<li class="detail-list__row--plain">
			<span>Descuento</span><span>−{formatPesos(quote.discount)}</span>
		</li>
	{/if}
	<li class="detail-list__row--plain">
		<span>Transporte</span>
		<span>{null === quote.transportCost ? 'por acordar' : formatPesos(quote.transportCost)}</span>
	</li>
	<li class="detail-list__row--strong">
		<span>{isTransportPending ? 'Total sin transporte' : 'Total'}</span>
		<span>{formatPesos(quote.quoteTotal)}</span>
	</li>
</ul>

{#if quote.notes}
	<h2 class="section-title">Notas</h2>
	<p class="notes">{quote.notes}</p>
{/if}

<!-- Plain links to WhatsApp: no form, no endpoint, nothing written. -->
{#if data.confirmHref && data.changesHref}
	<div class="answers">
		<Button href={data.confirmHref} target="_blank" rel="noopener">Confirmar cotización</Button>
		<Button variant="secondary" href={data.changesHref} target="_blank" rel="noopener">
			Solicitar cambios
		</Button>
	</div>
{/if}

{#if data.terms}
	<h2 class="section-title terms-title">Términos y condiciones</h2>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderTerms' output: raw HTML escaped, links and images filtered -->
	<div class="prose terms">{@html data.terms}</div>
{/if}

<style>
	.quote-title {
		margin: 36px 0 0;
		font-size: var(--text-3xl);
		font-weight: var(--weight-bold);
	}

	.quote-client {
		margin: var(--space-2) 0 var(--section-gap);
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}

	.detail-list .meta {
		display: block;
	}

	.rental-days {
		margin: calc(-1 * var(--space-2)) 0 var(--space-4);
	}

	.notes {
		margin: 0;
		font-size: var(--text-base);
		line-height: 1.4;
	}

	.answers {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-top: var(--space-11);
	}

	.terms-title {
		margin-top: var(--space-11);
	}

	/* As on «Su pedido»: the rule under the section title, the fine print a step smaller. */
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
		.quote-title {
			margin-top: 44px;
			font-size: 24px;
		}

		.answers {
			flex-direction: row;
		}
	}
</style>
