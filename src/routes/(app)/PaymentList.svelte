<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { formatLongDay } from '$lib/datetime';
	import { formatReceiptNumber, formatSignedPesos } from '$lib/format';
	import { CASH_CONCEPT_LABELS, PAYMENT_METHOD_LABELS } from '$lib/labels';
	import type { OrderPayment } from '$lib/server/services/orders';

	// The money on an order or a cuenta de cobro, each movement with its receipt. On a cuenta, `orderId`
	// marks what was paid on one of its orders.
	type Payment = OrderPayment & { orderId?: number | null };

	let { payments }: { payments: Payment[] } = $props();

	function receiptHref(payment: Payment): string {
		const query = new URLSearchParams({ movimiento: String(payment.id) });
		return `${resolve('/(app)/caja/comprobante')}?${query}`;
	}

	function paymentTitle(payment: Payment): string {
		const concept = CASH_CONCEPT_LABELS[payment.concept];
		return payment.orderId ? `${concept} · Pedido #${payment.orderId}` : concept;
	}

	// The method, and who a carrier payment went to: the client is the order's own.
	function paymentMeta(payment: Payment): string {
		const method = payment.otherMethod ?? PAYMENT_METHOD_LABELS[payment.method];
		const payee = 'CARRIER_PAYMENT' === payment.concept ? payment.payee : null;
		return [formatLongDay(payment.movementDate), method, payee, receiptName(payment)]
			.filter(Boolean)
			.join(' · ');
	}

	function receiptName(payment: Payment): string {
		const title = 0 < payment.amount ? 'Recibo de caja' : 'Comprobante de egreso';
		return `${title} # ${formatReceiptNumber(payment.receiptNumber)}`;
	}
</script>

{#if 0 === payments.length}
	<p class="note">Sin pagos todavía.</p>
{:else}
	<ul class="payments">
		{#each payments as payment (payment.id)}
			<li class="payment">
				<div class="payment__head">
					<span>{paymentTitle(payment)}</span>
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

<style>
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
</style>
