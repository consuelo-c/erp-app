<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Button from '$lib/components/Button.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatLongDay } from '$lib/datetime';
	import { formatIdNumber, formatPesos } from '$lib/format';
	import { CASH_CONCEPT_LABELS } from '$lib/labels';
	import { formatPhone } from '$lib/phone';
	import PaymentList from '../../PaymentList.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const receivable = $derived(data.receivable);
	const client = $derived(receivable.client);
	const isPaid = $derived(receivable.balance <= 0);
	const hasCredit = $derived(receivable.balance < 0);

	// Set by the payment entry's redirect: the payment just recorded, its receipt in «Pagos».
	const recordedPayment = $derived(
		receivable.payments.find(({ id }) => String(id) === page.url.searchParams.get('pago'))
	);
</script>

<svelte:head>
	<title>Cuenta de cobro Nº {receivable.id} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader
			title="Cuenta de cobro Nº {receivable.id}"
			backHref={resolve('/cuentas-de-cobro')}
		/>
	{/snippet}

	{#if recordedPayment}
		<div class="lead-notice">
			<Notice tone="success">
				Pago registrado: {CASH_CONCEPT_LABELS[recordedPayment.concept]} · {formatPesos(
					recordedPayment.amount
				)}
			</Notice>
		</div>
	{/if}

	<h2 class="section-title client-name">{client.name}</h2>
	{#if null !== client.documentId}
		<p class="meta document">NIT/C.C. {formatIdNumber(client.documentId)}</p>
	{/if}
	<div class="reach">
		<span>{formatPhone(client.phone)}</span>
		<IconButton icon="phone" size="lg" label="Llamar a {client.name}" href="tel:+{client.phone}" />
	</div>

	<h2 class="section-title">Cuenta de cobro</h2>
	<ul class="detail-list">
		<li class="detail-list__row--plain">
			<span>Fecha de emisión</span><span>{formatLongDay(receivable.issueDate)}</span>
		</li>
		<li class="detail-list__row--plain">
			<span>Forma de pago</span><span>{receivable.paymentTerms}</span>
		</li>
	</ul>

	<h2 class="section-title">Pedidos ({receivable.orders.length})</h2>
	<ul class="detail-list">
		{#each receivable.orders as order (order.id)}
			<li>
				<a href={resolve('/(app)/pedidos/[id]', { id: String(order.id) })}>Pedido #{order.id}</a>
				<span class="order-money">
					{formatPesos(order.orderTotal)}
					<span class="meta">{formatLongDay(order.eventDate)}</span>
				</span>
			</li>
		{/each}
	</ul>

	<h2 class="section-title">Totales</h2>
	<ul class="detail-list">
		<li class="detail-list__row--strong">
			<span>Total</span><span>{formatPesos(receivable.total)}</span>
		</li>
		<li class="detail-list__row--plain">
			<span>Pagado</span><span>{formatPesos(receivable.paid)}</span>
		</li>
		<li class="detail-list__row--strong">
			<span>{hasCredit ? 'Saldo a favor' : 'Saldo'}</span>
			{#if hasCredit}
				<span class="settled">{formatPesos(-receivable.balance)}</span>
			{:else if isPaid}
				<span class="settled">Pagado</span>
			{:else}
				<span>{formatPesos(receivable.balance)}</span>
			{/if}
		</li>
	</ul>

	<h2 class="section-title">Pagos</h2>
	<PaymentList payments={receivable.payments} />

	<!-- STUB: #422 (phase 16) gives «Imprimir» its route, the printout (46). -->
	<div class="screen__action">
		<Button
			variant="secondary"
			size="sm"
			href={resolve('/(app)/cuentas-de-cobro/[id]/editar', { id: String(receivable.id) })}
		>
			Editar
		</Button>
		<Button variant="secondary" size="sm" disabled>Imprimir</Button>
		<Button href={resolve('/(app)/cuentas-de-cobro/[id]/pago', { id: String(receivable.id) })}>
			Registrar pago
		</Button>
	</div>
</Screen>

<style>
	.lead-notice {
		margin-bottom: var(--space-8);
	}

	.client-name {
		margin-bottom: var(--space-2);
	}

	.document {
		margin: 0;
	}

	/* 24px apart: each icon's 48px hit area overhangs its glyph by 11px on either side. */
	.reach {
		display: flex;
		gap: var(--space-12);
		align-items: center;
		margin-bottom: var(--space-8);
		color: var(--link);
	}

	.reach > span {
		color: var(--text-body);
	}

	.order-money {
		text-align: right;
	}

	.order-money .meta {
		display: block;
	}

	.settled {
		color: var(--success-fg);
	}
</style>
