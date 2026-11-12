<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatBalance } from '$lib/format';
	import type { OrderPaymentConcept } from '$lib/orders';
	import PaymentEntry from '../../../PaymentEntry.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const order = $derived(data.order);
	const carriers = $derived(data.options.carriers);
	const receivableId = $derived(order.receivableId);
	const isBilled = $derived(null !== receivableId);

	// Why «Pago» isn't offered.
	const conceptNote = $derived.by(() => {
		if (isBilled) {
			return `El pago va en la cuenta de cobro Nº ${receivableId}.`;
		}
		return order.balanceDue <= 0 ? 'Este pedido ya está pagado.' : undefined;
	});

	// Valor starts at what's pending under the concept: the balance, the deposit still to receive,
	// or the one held.
	function pendingOf(option: OrderPaymentConcept): number {
		if ('INSTALLMENT' === option) {
			return order.balanceDue;
		}
		if ('SECURITY_DEPOSIT' === option) {
			return order.depositAmount - order.depositHeld;
		}
		if ('DEPOSIT_REFUND' === option) {
			return order.depositHeld;
		}
		return 0;
	}

	function amountWarning(concept: OrderPaymentConcept, amount: number): string | null {
		if ('INSTALLMENT' === concept && amount > order.balanceDue) {
			return `Supera el saldo del pedido (${formatBalance(order.balanceDue)}).`;
		}
		if ('INSTALLMENT_REFUND' === concept && amount > order.paid) {
			return `Devuelve más de lo pagado (${formatBalance(order.paid)}).`;
		}
		if ('DEPOSIT_REFUND' === concept && amount > order.depositHeld) {
			return `Devuelve más del depósito recibido (${formatBalance(order.depositHeld)}).`;
		}
		return null;
	}

</script>

<svelte:head>
	<title>Registrar pago · Pedido #{order.id} · Banquetes Consuelo C</title>
</svelte:head>

<PaymentEntry
	lead={isBilled
		? `Pedido #${order.id} · Cuenta de cobro Nº ${receivableId}`
		: `Pedido #${order.id} · Saldo ${formatBalance(order.balanceDue)}`}
	{conceptNote}
	closeHref={resolve('/(app)/pedidos/[id]', { id: String(order.id) })}
	concepts={data.concepts}
	clientName={order.client.name}
	clientBankAccount={data.options.clientBankAccount}
	{carriers}
	today={data.today}
	{form}
	{pendingOf}
	warningOf={amountWarning}
/>
