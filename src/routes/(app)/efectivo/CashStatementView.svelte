<script lang="ts">
	import type { Snippet } from 'svelte';
	import Card from '$lib/components/Card.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import { formatShortDay } from '$lib/datetime';
	import { formatBalance, formatPesos, formatReceiptNumber, formatSignedPesos } from '$lib/format';
	import { CASH_CONCEPT_LABELS, PAYMENT_METHOD_LABELS } from '$lib/labels';
	import type {
		CashStatement,
		StatementGroup,
		StatementMovement
	} from '$lib/server/services/cash-handovers';

	// A person's tab: the all-time «Por entregar» on top, then the range's movements, order by
	// order, and handovers. The range is a GET form, so a range is a URL. On the manager's screen
	// `username` keeps the chosen person in it, and `status` sits by the card's label, the amount
	// under it. The person's own tab explains the card (`cardHint`) and who records handovers
	// (`footnote`).
	interface Props {
		statement: CashStatement;
		username?: string;
		status?: Snippet;
		cardHint?: string;
		footnote?: string;
	}

	let { statement, username, status, cardHint, footnote }: Props = $props();

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

	// A transfer says why it doesn't count instead of its receipt.
	function movementMeta(movement: StatementMovement): string {
		return [
			formatShortDay(movement.movementDate),
			PAYMENT_METHOD_LABELS[movement.paymentMethod],
			movement.isCounted ? receipt(movement) : 'no cuenta: está en el banco'
		].join(' · ');
	}

	function handoverMeta(handover: CashStatement['handovers'][number]): string {
		const facts = [formatShortDay(handover.handoverDate), `Recibió ${handover.recordedBy}`];
		return [...facts, ...(null === handover.note ? [] : [`«${handover.note}»`])].join(' · ');
	}

	function submitOnChange(event: Event & { currentTarget: HTMLFormElement }) {
		event.currentTarget.requestSubmit();
	}
</script>

<Card>
	{#snippet head()}
		<b class="card-label">Por entregar</b>
		{#if status}
			{@render status()}
		{:else}
			<b class="pending">{formatBalance(statement.pending)}</b>
		{/if}
	{/snippet}
	{#if status}
		<b class="pending">{formatBalance(statement.pending)}</b>
	{/if}
	{#if cardHint}
		<p class="meta card-hint">{cardHint}</p>
	{/if}
</Card>

<form method="get" class="range" onchange={submitOnChange}>
	{#if undefined !== username}
		<input type="hidden" name="persona" value={username} />
	{/if}
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
					<span class="meta">{movementMeta(movement)}</span>
				</span>
				{#if movement.isCounted}
					<b>{formatSignedPesos(movement.amount)}</b>
				{:else}
					<span>{formatBalance(movement.amount)}</span>
				{/if}
			</li>
		{/each}
	{/each}
</ul>

<h2 class="section-title">Entregas</h2>
{#if 0 === statement.handovers.length}
	<p class="meta">Ninguna en estas fechas.</p>
{:else}
	<ul class="detail-list">
		{#each statement.handovers as handover (handover.id)}
			<li class="movement">
				<span class="movement__text">
					<span>Entrega</span>
					<span class="meta">{handoverMeta(handover)}</span>
				</span>
				<b>−{formatPesos(handover.amount)}</b>
			</li>
		{/each}
	</ul>
{/if}

{#if footnote}
	<p class="meta footnote">{footnote}</p>
{/if}

<style>
	.card-label {
		font-size: var(--text-base);
	}

	.pending {
		font-size: var(--text-3xl);
	}

	.card-hint {
		margin: var(--space-1) 0 0;
	}

	.footnote {
		margin-top: var(--space-7);
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
		color: var(--text-secondary);
	}
</style>
