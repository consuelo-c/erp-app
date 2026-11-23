<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { online } from 'svelte/reactivity/window';
	import { formatBalance, formatPesos } from '$lib/format';
	import type { OrderPaymentConcept } from '$lib/orders';
	import PaymentEntry from '../../../PaymentEntry.svelte';
	import type { PageProps } from './$types';

	// The office's «Registrar pago», cut down to what Despachos records on the road: the concepts,
	// methods, locks and notes the service gives this login now, and only with signal.
	let { data, form }: PageProps = $props();

	const order = $derived(data.order);

	// At pickup the deposit held is what's given back; on the way, what's still owed of it.
	const isRefundOnly = $derived(
		data.entry.concepts.every((concept) => 'DEPOSIT_REFUND' === concept)
	);
	const deposit = $derived(
		isRefundOnly
			? `Depósito recibido ${formatBalance(order.depositHeld)}`
			: `Depósito ${formatBalance(order.depositHeld)} de ${formatPesos(order.depositAmount)}`
	);
	const lead = $derived(
		null === order.receivableId
			? `Pedido #${order.id} · ${order.client.name} · Saldo ${formatBalance(order.balanceDue)} · ${deposit}`
			: `Pedido #${order.id} · ${order.client.name} · Cuenta de cobro Nº ${order.receivableId}`
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
	{lead}
	notesPlaceholder={isRefundOnly ? 'Ej. Sin daños en la recogida' : 'Ej. Pagó al recibir'}
	closeHref="{resolve('/(app)/despachos/[id]', { id: String(order.id) })}{page.url.search}"
	concepts={data.entry.concepts}
	methods={data.entry.methods}
	methodHintOf={(method) => data.entry.methodHints[method]}
	isOffline={false === online.current}
	clientName={order.client.name}
	clientBankAccount={data.options.clientBankAccount}
	today={data.today}
	{form}
	{pendingOf}
	activeIncidents={data.activeIncidents}
	depositHeld={order.depositHeld}
	amountLockNoteOf={(concept) => data.entry.amountLocks[concept]}
	{warningOf}
/>
