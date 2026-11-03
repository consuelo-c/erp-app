<script lang="ts">
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import { formatPesos, formatShare } from '$lib/format';
	import { parsePesos } from '$lib/payroll';

	// «Totales»: the discount in pesos, with its share of the subtotal for reference, the transport
	// and the total, as typed. The order form and the quote form share it; the server works the
	// totals out again.
	interface Props {
		discount: string;
		transport: string;
		itemsTotal: number;
		total: number;
		errorOf: (path: string) => string | undefined;
	}

	let {
		discount = $bindable(),
		transport = $bindable(),
		itemsTotal,
		total,
		errorOf
	}: Props = $props();

	// For reference only: the discount is stored in pesos.
	const discountShare = $derived(
		0 === itemsTotal ? '' : `≈ ${formatShare(parsePesos(discount), itemsTotal)}`
	);
</script>

<h2 class="section-title">Totales</h2>
<div class="form-stack">
	<Field label="Descuento" id="discount" error={errorOf('discount')}>
		<div class="discount">
			<Input
				id="discount"
				inputmode="numeric"
				placeholder="$0"
				aria-invalid={undefined !== errorOf('discount')}
				bind:value={discount}
			/>
			<span class="discount__share">{discountShare}</span>
		</div>
	</Field>
	<Field label="Transporte" id="transport" error={errorOf('transport_cost')}>
		<Input
			id="transport"
			inputmode="numeric"
			placeholder="$0"
			aria-invalid={undefined !== errorOf('transport_cost')}
			bind:value={transport}
		/>
	</Field>
</div>
<div class="summary-row summary-row--total">
	<span>Total</span><span>{formatPesos(total)}</span>
</div>

<style>
	.section-title {
		margin: var(--space-4) 0 0;
	}

	/* The Design System's summary row: the total under its ink rule. */
	.summary-row {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		justify-content: space-between;
		font-size: var(--text-base);
		line-height: var(--leading-loose);
		color: var(--text-secondary);
	}

	.summary-row > :last-child {
		font-weight: var(--weight-semibold);
		color: var(--text-body);
	}

	.summary-row--total {
		padding: var(--space-7) 0;
		font-size: var(--text-lg);
		font-weight: var(--weight-bold);
		line-height: 1.2;
		color: var(--text-body);
		border-top: var(--border-w) solid var(--border-strong);
	}

	.summary-row--total > :last-child {
		font: var(--type-total);
	}

	.discount {
		display: flex;
		gap: var(--space-6);
		align-items: center;
	}

	.discount__share {
		flex: none;
		width: 64px;
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
		color: var(--text-secondary);
	}
</style>
