<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { formatClockTime, formatLongDay, formatShortDay } from '$lib/datetime';
	import { formatBalance, formatPesos } from '$lib/format';
	import { splitIntoPages } from '$lib/orders';
	import { formatPhone } from '$lib/phone';
	import type { OrderPrintout } from '$lib/server/services/orders';

	// Outside the app's shell: the half-letter sheets the client signs on receiving the order,
	// and what prints is the sheets. Each repeats the header; the client's data opens the first,
	// the totals and the signature close the last. Pedidos and Despachos print it, each going back
	// to its own detail.
	let { printout, backHref }: { printout: OrderPrintout; backHref: string } = $props();

	const { order, company } = $derived(printout);
	const delivery = $derived(order.delivery);
	const pickup = $derived(order.pickup);
	const pages = $derived(splitIntoPages(order.items));
	// The pickup address only when the products come back from somewhere else.
	const isPickupElsewhere = $derived(
		delivery.address_1 !== pickup.address_1 || delivery.address_2 !== pickup.address_2
	);

	function tripWhen(date: string, time: string | null): string {
		return null === time
			? formatShortDay(date)
			: `${formatShortDay(date)}, ${formatClockTime(time)}`;
	}
</script>

<svelte:head>
	<title>Pedido #{order.id} · {company.COMPANY_NAME}</title>
</svelte:head>

{#snippet address(line1: string, line2: string | null)}
	<span>
		{line1}
		{#if line2}<br />{line2}{/if}
	</span>
{/snippet}

<div class="printout">
	<div class="printout__toolbar">
		<Button href={backHref} variant="secondary" size="sm" inline>Volver al pedido</Button>
		<Button type="button" size="sm" inline onclick={() => window.print()}>Imprimir</Button>
	</div>

	{#each pages as lines, index (index)}
		{@const isLastPage = pages.length - 1 === index}
		<article class="print-sheet">
			<header class="print-head">
				<img
					class="print-head__logo"
					src="/banquetes-consuelo-c-logo.svg"
					alt={company.COMPANY_NAME}
				/>
				<div class="print-head__company">
					<div class="print-head__title">Pedido #{order.id}</div>
					<div class="print-small">{company.COMPANY_NAME}</div>
					<div class="print-small">{company.COMPANY_ADDRESS}</div>
					<div class="print-small">{company.COMPANY_PHONE}</div>
					<div class={['print-small', { 'print-page--spills': 1 < pages.length }]}>
						{index + 1} de {pages.length}
					</div>
				</div>
			</header>

			{#if 0 === index}
				<div class="print-row"><span>Cliente</span><span>{order.client.name}</span></div>
				<div class="print-row">
					<span>Teléfono</span><span>{formatPhone(order.client.phone)}</span>
				</div>
				<div class="print-row">
					<span>Dirección de entrega</span>
					{#if 'CLIENT_PICKUP' === delivery.method}
						<span>Recoge el cliente en la bodega</span>
					{:else}
						{@render address(delivery.address_1, delivery.address_2)}
					{/if}
				</div>
				{#if 'CLIENT_RETURN' === pickup.method}
					<div class="print-row">
						<span>Dirección de recogida</span><span>Devuelve el cliente en la bodega</span>
					</div>
				{:else if isPickupElsewhere}
					<div class="print-row">
						<span>Dirección de recogida</span>
						{@render address(pickup.address_1, pickup.address_2)}
					</div>
				{/if}

				<div class="print-group">
					<div class="print-row">
						<span>Evento</span><span>{formatLongDay(order.eventDate)}</span>
					</div>
					<div class="print-row">
						<span>Entrega</span><span>{tripWhen(order.deliveryDate, delivery.time)}</span>
					</div>
					<div class="print-row">
						<span>Recogida</span><span>{tripWhen(order.pickupDate, pickup.time)}</span>
					</div>
					<div class="print-row"><span>Días cobrados</span><span>{order.rentalDays}</span></div>
				</div>
			{/if}

			{#if lines.length}
				<table class="print-table">
					<thead>
						<tr>
							<th>Producto</th>
							<th class="num">Cant.</th>
							<th class="num">Precio unit.</th>
							<th class="num">Total</th>
						</tr>
					</thead>
					<tbody>
						{#each lines as item (item.product_id)}
							<tr>
								<td>{item.name}</td>
								<td class="num">{item.qty}</td>
								<td class="num">{formatPesos(item.unit_price)}</td>
								<td class="num">{formatPesos(item.line_total)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			<div class="print-spacer"></div>

			{#if isLastPage}
				<div class="print-row">
					<span>Subtotal</span><span>{formatPesos(order.itemsTotal)}</span>
				</div>
				<div class="print-row">
					<span>Descuento</span>
					<span>{0 === order.discount ? formatPesos(0) : `−${formatPesos(order.discount)}`}</span>
				</div>
				<div class="print-row">
					<span>Transporte</span><span>{formatPesos(order.transportCost)}</span>
				</div>
				<div class="print-row print-row--strong print-total">
					<span>Total</span><span>{formatPesos(order.orderTotal)}</span>
				</div>
				<div class="print-row">
					<span>Depósito</span><span>{formatPesos(order.depositAmount)}</span>
				</div>
				<div class="print-row"><span>Pagado</span><span>{formatBalance(order.paid)}</span></div>
				<div class="print-row print-row--strong">
					<span>Saldo</span><span>{formatBalance(order.balanceDue)}</span>
				</div>

				<!-- The client's proof of receipt: never sacrificed for space. -->
				<div class="signature">Recibí: Nombre / C.C. / NIT</div>
			{:else}
				<div class="print-small print-continues">
					Continúa en la hoja {index + 2} · {order.items.length} líneas
				</div>
			{/if}
		</article>
	{/each}
</div>

<style>
	/* Half-letter portrait, edge to edge: the sheet carries its own margins. */
	@page {
		size: 5.5in 8.5in;
		margin: 0;
	}

	.printout {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		align-items: center;
		min-height: 100vh;
		padding: var(--space-10) var(--screen-pad-x);
		background: var(--surface-subtle);
	}

	.printout__toolbar {
		display: flex;
		gap: var(--control-gap);
		justify-content: space-between;
		width: var(--print-sheet-w);
		max-width: 100%;
	}

	.print-sheet {
		box-sizing: border-box;
		display: flex;
		flex: none;
		flex-direction: column;
		width: var(--print-sheet-w);
		height: var(--print-sheet-h);
		padding: 22px 26px;
		font: var(--weight-regular) var(--print-base) / 1.35 var(--font-sans);
		color: var(--text-body);
		background: var(--neutral-0);
		box-shadow: var(--shadow-paper);
	}

	.print-head {
		display: flex;
		gap: var(--space-8);
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: var(--space-7);
	}

	.print-head__logo {
		display: block;
		width: 140px;
		height: auto;
	}

	.print-head__company {
		text-align: right;
	}

	.print-head__title {
		margin-bottom: 3px;
		font-size: var(--print-title);
		font-weight: var(--weight-bold);
	}

	.print-small {
		font-size: var(--print-sm);
		color: var(--text-secondary);
	}

	.print-page--spills {
		font-weight: var(--weight-bold);
	}

	.print-group {
		margin-top: var(--space-4);
	}

	.print-row {
		display: flex;
		gap: var(--space-8);
		justify-content: space-between;
		margin-bottom: 3px;
	}

	.print-row > :first-child {
		color: var(--text-secondary);
	}

	.print-row > :last-child {
		max-width: 320px;
		text-align: right;
	}

	.print-row--strong {
		font-weight: var(--weight-bold);
	}

	.print-row--strong > :first-child {
		color: inherit;
	}

	.print-total {
		font-size: var(--print-lg);
	}

	.print-table {
		width: 100%;
		margin: var(--space-5) 0 var(--space-2);
		font-size: var(--print-md);
		border-collapse: collapse;
	}

	.print-table th {
		padding: 3px 5px;
		font-size: var(--print-xs);
		font-weight: var(--weight-bold);
		color: var(--text-secondary);
		text-align: left;
		border-bottom: var(--border-w) solid var(--border-strong);
	}

	.print-table td {
		padding: 3px 5px;
		vertical-align: top;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.print-table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}

	.print-spacer {
		flex: 1;
	}

	.print-continues {
		text-align: right;
	}

	.signature {
		flex: none;
		width: 62%;
		padding-top: var(--space-2);
		margin-top: 48px;
		font-size: var(--print-sm);
		color: var(--text-secondary);
		border-top: var(--border-w-hair) solid var(--border-strong);
	}

	@media print {
		.printout {
			display: block;
			min-height: 0;
			padding: 0;
			background: none;
		}

		.printout__toolbar {
			display: none;
		}

		.print-sheet {
			box-shadow: none;
		}

		.print-sheet + .print-sheet {
			break-before: page;
		}
	}
</style>
