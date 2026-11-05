<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatBalance } from '$lib/format';
	import PaymentEntry from '../../../PaymentEntry.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const receivable = $derived(data.receivable);
</script>

<svelte:head>
	<title>Registrar pago · Cuenta de cobro Nº {receivable.id} · Banquetes Consuelo C</title>
</svelte:head>

<PaymentEntry
	lead="Cuenta de cobro Nº {receivable.id} · Saldo {formatBalance(receivable.balance)}"
	closeHref={resolve('/(app)/cuentas-de-cobro/[id]', { id: String(receivable.id) })}
	concepts={['INSTALLMENT']}
	initialMethod="TRANSFER"
	notesPlaceholder="Ej. Transferencia de tesorería"
	clientName={receivable.client.name}
	today={data.today}
	{form}
	pendingOf={() => receivable.balance}
	amountLockNote="La cuenta de cobro se paga completa."
/>
