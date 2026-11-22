<script lang="ts">
	import { resolve } from '$app/paths';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatDayRange, formatPeriod, formatShortDay } from '$lib/datetime';
	import type { PageProps } from './$types';

	// What the orders need more of than the company owns, each product on its worst day: a row on
	// a desktop, a card on a phone, both a `<details>` opening to the orders holding it that day.
	let { data }: PageProps = $props();

	const report = $derived(data.report);
	const count = $derived(report.products.length);
	const summary = $derived(
		`${formatPeriod(report.from, report.to)} · ${count} ${1 === count ? 'producto' : 'productos'} por subalquilar`
	);

	function submitOnChange(event: Event & { currentTarget: HTMLFormElement }) {
		event.currentTarget.requestSubmit();
	}
</script>

<svelte:head>
	<title>Subalquiler · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Subalquiler" />
	{/snippet}

	<!-- No apply button: a changed date reloads the report. -->
	<form
		class="dates"
		method="GET"
		data-sveltekit-keepfocus
		data-sveltekit-noscroll
		onchange={submitOnChange}
	>
		<Field label="Desde" id="desde">
			<Input id="desde" name="desde" type="date" value={report.from} />
		</Field>
		<Field label="Hasta" id="hasta">
			<Input id="hasta" name="hasta" type="date" value={report.to} />
		</Field>
	</form>

	<Notice tone="info">
		Solo cuentan los pedidos que apartan productos, de Confirmado a En ruta de recogida. Las
		cotizaciones no se cuentan.
	</Notice>

	{#if 0 === count}
		<div class="none">
			<p class="none__title">No hace falta subalquilar nada</p>
			<p class="meta">Los pedidos de estas fechas caben en el inventario.</p>
		</div>
	{:else}
		<p class="meta summary desktop-only">{summary}</p>

		<div class="products">
			<div class="product__head desktop-only" aria-hidden="true">
				<span>Producto</span><span class="num">Tenemos</span><span class="num">Apartados</span><span
					class="num">Faltan</span
				><span>Peor día</span>
			</div>
			{#each report.products as product (product.productId)}
				<details class="product">
					<summary class="product__summary">
						<span class="product__name">{product.name}</span>
						<span class="num desktop-only">{product.owned}</span>
						<span class="num desktop-only">{product.held}</span>
						<span class="num product__missing"
							><span class="phone-only">Faltan </span>{product.missing}</span
						>
						<span class="desktop-only">{formatShortDay(product.worstDay)}</span>
						<span class="meta product__facts phone-only"
							>Tenemos {product.owned} · Apartados {product.held} · {formatShortDay(
								product.worstDay
							)}</span
						>
					</summary>
					<div class="product__body">
						<p class="meta desktop-only">
							Pedidos que lo apartan el {formatShortDay(product.worstDay)}
						</p>
						<ul class="orders">
							{#each product.orders as order (order.id)}
								<li>
									<span
										><a href={resolve('/(app)/pedidos/[id]', { id: String(order.id) })}
											>#{order.id}</a
										>
										· {order.clientName}<span class="desktop-only-inline">
											· {formatDayRange(order.deliveryDate, order.pickupDate)}</span
										></span
									>
									<b>{order.quantity}</b>
								</li>
							{/each}
						</ul>
					</div>
				</details>
			{/each}
		</div>
	{/if}
</Screen>

<style>
	p {
		margin: 0;
	}

	.desktop-only,
	.desktop-only-inline {
		display: none;
	}

	.dates {
		display: flex;
		gap: var(--control-gap);
		margin-bottom: var(--space-7);
	}

	.dates > :global(*) {
		flex: 1;
		min-width: 0;
	}

	.summary {
		margin: var(--space-8) 0 var(--space-4);
	}

	.none {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		align-items: center;
		padding-top: var(--space-14);
		text-align: center;
	}

	.none__title {
		font-size: var(--text-md);
		font-weight: var(--weight-semibold);
	}

	.products {
		margin-top: var(--space-7);
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.product {
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	/* A phone: the name and what's missing across the top, the facts under them. */
	.product__summary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-2) var(--space-6);
		align-items: baseline;
		padding: var(--space-6) 0;
		font-size: var(--text-base);
		cursor: pointer;
		list-style: none;
	}

	.product__summary::-webkit-details-marker {
		display: none;
	}

	.product__missing {
		font-weight: var(--weight-bold);
	}

	.product__facts {
		grid-column: 1 / -1;
	}

	.product__body {
		padding: 0 0 var(--space-6);
	}

	.orders {
		padding: 0;
		margin: 0;
		font-size: var(--text-sm);
		list-style: none;
	}

	.orders li {
		display: flex;
		gap: var(--space-4);
		justify-content: space-between;
		padding: var(--space-3) 0;
		border-top: var(--border-w-hair) dashed var(--border-default);
	}

	.num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	@container (width >= 1024px) {
		.phone-only {
			display: none;
		}

		.desktop-only {
			display: block;
		}

		.desktop-only-inline {
			display: inline;
		}

		.dates {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 220px));
		}

		.products {
			margin-top: 0;
		}

		.product__head,
		.product__summary {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 110px 110px 110px 140px;
			gap: var(--space-6);
			align-items: baseline;
			padding: var(--space-5) var(--space-2);
		}

		.product__head {
			font-size: var(--text-sm);
			font-weight: var(--weight-bold);
			color: var(--text-secondary);
			border-bottom: var(--border-w-hair) solid var(--border-default);
		}

		.product__summary {
			font-size: var(--text-md);
		}

		.product__body {
			padding: 0 var(--space-2) var(--space-6) var(--space-9);
		}

		.product__body .meta {
			margin-bottom: var(--space-3);
		}
	}
</style>
