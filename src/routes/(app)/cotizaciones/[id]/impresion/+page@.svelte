<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatLongDay, getInstantDate } from '$lib/datetime';
	import { formatPesos } from '$lib/format';
	import { formatPhone } from '$lib/phone';
	import HalfLetterPrintout from '../../../pedidos/HalfLetterPrintout.svelte';
	import type { PageProps } from './$types';

	// The paper a company's purchasing department asks for: the client and the event open the first
	// sheet, the totals and the notes close the last. Nobody receives anything against it: no
	// signature, deposit, payments or terms.
	let { data }: PageProps = $props();

	const { quote, document, company } = $derived(data.printout);
	const isTransportPending = $derived(null === quote.transportCost);
</script>

{#snippet opening()}
	<div class="print-row">
		<span>Fecha</span><span>{formatLongDay(getInstantDate(quote.createdAt))}</span>
	</div>
	<div class="print-row">
		<span>Válida hasta</span><span>{formatLongDay(quote.validUntil)}</span>
	</div>

	<div class="print-group">
		<div class="print-row"><span>Cliente</span><span>{quote.client.name}</span></div>
		<div class="print-row">
			<span>Teléfono</span><span>{formatPhone(quote.client.phone)}</span>
		</div>
		{#if document}
			<div class="print-row"><span>NIT / C.C.</span><span>{document}</span></div>
		{/if}
	</div>

	<div class="print-group">
		{#if quote.eventDate}
			<div class="print-row">
				<span>Evento</span><span>{formatLongDay(quote.eventDate)}</span>
			</div>
		{/if}
		{#if quote.address1}
			<div class="print-row">
				<span>Lugar del evento</span>
				<span>
					{quote.address1}
					{#if quote.address2}<br />{quote.address2}{/if}
				</span>
			</div>
		{/if}
		<div class="print-row"><span>Días cobrados</span><span>{quote.rentalDays}</span></div>
	</div>
{/snippet}

{#snippet closing()}
	<div class="print-row">
		<span>Subtotal</span><span>{formatPesos(quote.itemsTotal)}</span>
	</div>
	<div class="print-row">
		<span>Descuento</span>
		<span>{0 === quote.discount ? formatPesos(0) : `−${formatPesos(quote.discount)}`}</span>
	</div>
	<div class="print-row">
		<span>Transporte</span>
		<span>{null === quote.transportCost ? 'Por acordar' : formatPesos(quote.transportCost)}</span>
	</div>
	<div class="print-row print-row--strong print-total">
		<span>{isTransportPending ? 'Total sin transporte' : 'Total'}</span>
		<span>{formatPesos(quote.quoteTotal)}</span>
	</div>

	{#if quote.notes}
		<div class="notes">
			<div class="print-small">Notas</div>
			<p>{quote.notes}</p>
		</div>
	{/if}
{/snippet}

<HalfLetterPrintout
	title="Cotización #{quote.id}"
	{company}
	items={quote.items}
	back={{
		href: resolve('/(app)/cotizaciones/[id]', { id: String(quote.id) }),
		label: 'Volver a la cotización'
	}}
	{opening}
	{closing}
/>

<style>
	.notes {
		margin-top: var(--space-7);
	}

	.notes p {
		margin: 2px 0 0;
		white-space: pre-line;
	}
</style>
