<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { online } from 'svelte/reactivity/window';
	import { formatBalance } from '$lib/format';
	import type { OrderPaymentConcept } from '$lib/orders';
	import type { PaymentMethod } from '$lib/server/services/cash';
	import PaymentEntry from '../../../PaymentEntry.svelte';
	import type { PageProps } from './$types';

	// The office's «Registrar pago», cut down to what Despachos records on the road: the concepts
	// this login is offered now, cash or transfer, and only with signal.
	let { data, form }: PageProps = $props();

	const order = $derived(data.order);
	const METHODS: PaymentMethod[] = ['CASH', 'TRANSFER'];

	// The refund the driver would get, held back by an active incident.
	const notice = $derived(
		order.hasIncident &&
			'OUT_FOR_PICKUP' === order.status &&
			0 < order.depositHeld &&
			!data.concepts.includes('DEPOSIT_REFUND')
			? 'El pedido tiene una novedad activa: la devolución del depósito la hace la oficina.'
			: undefined
	);

	function pendingOf(concept: OrderPaymentConcept): number {
		if ('INSTALLMENT' === concept) {
			return order.balanceDue;
		}
		if ('SECURITY_DEPOSIT' === concept) {
			return order.depositAmount - order.depositHeld;
		}
		return 'DEPOSIT_REFUND' === concept ? order.depositHeld : 0;
	}

	function amountLockNoteOf(concept: OrderPaymentConcept): string | undefined {
		return data.isRefundWhole && 'DEPOSIT_REFUND' === concept
			? 'Se devuelve todo el depósito recibido. Una devolución parcial la hace la oficina.'
			: undefined;
	}

	function methodHintOf(method: PaymentMethod): string | undefined {
		return 'CASH' === method
			? 'El efectivo queda en tu cuenta de «Efectivo por entregar» hasta que lo entregues en la oficina.'
			: undefined;
	}

	function warningOf(concept: OrderPaymentConcept, amount: number): string | null {
		if ('INSTALLMENT' === concept && amount > order.balanceDue) {
			return `Supera el saldo del pedido (${formatBalance(order.balanceDue)}).`;
		}
		if ('DEPOSIT_REFUND' === concept && amount > order.depositHeld) {
			return `Devuelve más del depósito recibido (${formatBalance(order.depositHeld)}).`;
		}
		return null;
	}
</script>

<svelte:head>
	<title>Registrar pago · Pedido #{order.id} · Despachos · Banquetes Consuelo C</title>
</svelte:head>

<PaymentEntry
	lead={null === order.receivableId
		? `Pedido #${order.id} · Saldo ${formatBalance(order.balanceDue)}`
		: `Pedido #${order.id} · Cuenta de cobro Nº ${order.receivableId}`}
	{notice}
	closeHref="{resolve('/(app)/despachos/[id]', { id: String(order.id) })}{page.url.search}"
	concepts={data.concepts}
	methods={METHODS}
	{methodHintOf}
	isOffline={false === online.current}
	clientName={order.client.name}
	clientBankAccount={data.options.clientBankAccount}
	today={data.today}
	{form}
	{pendingOf}
	{amountLockNoteOf}
	{warningOf}
/>
