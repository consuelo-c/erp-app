<script lang="ts">
	import Card from '$lib/components/Card.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import { formatCivilDate } from '$lib/datetime';
	import { formatBalance, formatPesos, formatReceiptNumber, formatSignedPesos } from '$lib/format';
	import { CASH_CONCEPT_LABELS, PAYMENT_METHOD_LABELS } from '$lib/labels';
	import type {
		CashStatement,
		StatementGroup,
		StatementMovement
	} from '$lib/server/services/cash-handovers';

	// A person's tab: the all-time «Por entregar» on top, then the range's movements, order by
	// order, and handovers. The range is a GET form, so a range is a URL.
	interface Props {
		statement: CashStatement;
	}

	let { statement }: Props = $props();

	// «#1043 · Pago»: the order, or the cuenta de cobro, it belongs to, and what it was.
	function title(group: StatementGroup, movement: StatementMovement): string {
		const concept = CASH_CONCEPT_LABELS[movement.concept];
		if (null !== group.orderId) {
			return `#${group.orderId} · ${concept}`;
		}
		return null === group.receivableId ? concept : `Nº ${group.receivableId} · ${concept}`;
	}

	function receipt({ amount, receiptNumber }: StatementMovement): string {
		const name = 0 < amount ? 'Recibo de caja' : 'Comprobante de egreso';
		return `${name} # ${formatReceiptNumber(receiptNumber)}`;
	}

	function submitOnChange(event: Event & { currentTarget: HTMLFormElement }) {
		event.currentTarget.requestSubmit();
	}
</script>

<Card>
	<p class="meta">Por entregar</p>
	<p class="pending">{formatBalance(statement.pending)}</p>
</Card>

<form method="get" class="range" onchange={submitOnChange}>
	<Field label="Desde" id="desde">
		<Input id="desde" name="desde" type="date" value={statement.range.from} />
	</Field>
	<Field label="Hasta" id="hasta">
		<Input id="hasta" name="hasta" type="date" value={statement.range.to} />
	</Field>
</form>

<h2 class="section-title">Movimientos</h2>
<ul class="detail-list">
	{#each statement.groups as group (`${group.orderId}:${group.receivableId}`)}
		{#each group.movements as movement (movement.id)}
			<li class={['movement', !movement.isCounted && 'movement--uncounted']}>
				<span class="movement__text">
					<span>{title(group, movement)}</span>
					<span class="meta">
						{[
							receipt(movement),
							PAYMENT_METHOD_LABELS[movement.paymentMethod],
							formatCivilDate(movement.movementDate)
						].join(' · ')}
					</span>
					{#if !movement.isCounted}
						<span class="note">no cuenta: está en el banco</span>
					{/if}
				</span>
				<span>{formatSignedPesos(movement.amount)}</span>
			</li>
		{/each}
	{/each}
</ul>

<h2 class="section-title">Entregas</h2>
<ul class="detail-list">
	{#each statement.handovers as handover (handover.id)}
		<li class="movement">
			<span class="movement__text">
				<span>{formatCivilDate(handover.handoverDate)}</span>
				{#if null !== handover.note}
					<span class="meta">{handover.note}</span>
				{/if}
			</span>
			<span>{formatPesos(handover.amount)}</span>
		</li>
	{/each}
</ul>

<style>
	.pending {
		margin: 0;
		font-size: var(--text-display);
		font-weight: var(--weight-bold);
	}

	.range {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-5);
		margin-bottom: var(--space-9);
	}

	.movement {
		padding: var(--space-4) 0;
	}

	.movement__text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.movement--uncounted {
		color: var(--text-disabled);
	}
</style>
