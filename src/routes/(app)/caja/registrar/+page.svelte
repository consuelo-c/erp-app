<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatInteger, formatPesos, formatReceiptNumber, formatSignedPesos } from '$lib/format';
	import { CASH_CONCEPT_LABELS, PAYMENT_METHOD_LABELS } from '$lib/labels';
	import { CASH_TABS } from '$lib/navigation';
	import { parsePesos } from '$lib/payroll';
	import type { CashConcept, MovementDetail } from '$lib/server/services/cash';
	import type { PageProps } from './$types';

	// A tab, not a sheet or a dialog: the confirmation never sits on top of another window. What's
	// typed is read off the form as it changes; Tipo and Método decide the label and which fields show.
	// With `?corrige=` it's that movement's offsetting movement: pre-filled from it, Tipo flipped and
	// locked, and the amount the original's.
	let { data, form }: PageProps = $props();

	const original = $derived(data.original);

	let entered = $state<FormData | null>(null);
	const typed = (name: string, initial: string) => String(entered?.get(name) ?? initial);
	const errorOf = (name: string): string | undefined => form?.errors?.[name];

	const lockedDirection = $derived(original ? oppositeDirection(original.amount) : null);
	const isInflow = $derived('IN' === (lockedDirection ?? typed('direction', 'OUT')));
	const method = $derived(typed('payment_method', original?.method ?? 'CASH'));
	const conceptKey = $derived<CashConcept>(
		original?.concept ?? (isInflow ? 'OTHER_INCOME' : 'OTHER_EXPENSE')
	);
	const concept = $derived(CASH_CONCEPT_LABELS[conceptKey]);
	// An order's or a settlement's movement takes who and what from its link, not from the form.
	const isStandalone = $derived('OTHER_INCOME' === conceptKey || 'OTHER_EXPENSE' === conceptKey);
	const party = $derived(original?.employeeName ?? original?.payee ?? '');
	const amount = $derived(original ? Math.abs(original.amount) : parsePesos(typed('amount', '')));
	const methodLabel = $derived(
		'OTHER' === method
			? typed('other_method', '') || PAYMENT_METHOD_LABELS.OTHER
			: PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS]
	);

	function oppositeDirection(amount: number): 'IN' | 'OUT' {
		return amount < 0 ? 'IN' : 'OUT';
	}

	function receiptName({ amount, receiptNumber }: MovementDetail): string {
		const title = 0 < amount ? 'recibo de caja' : 'comprobante de egreso';
		return `${title} # ${formatReceiptNumber(receiptNumber)}`;
	}

	// What's being corrected, as the cash book shows it.
	function correctionNote(detail: MovementDetail): string {
		const week = null === detail.weekNumber ? '' : ` · semana ${detail.weekNumber}`;
		return [
			`Corrige el ${receiptName(detail)}`,
			`${CASH_CONCEPT_LABELS[detail.concept]}${week}`,
			detail.description ?? party,
			formatSignedPesos(detail.amount)
		].join(' · ');
	}

	const DIRECTION_OPTIONS = [
		['IN', 'Entrada'],
		['OUT', 'Salida']
	] as const;
	const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABELS);

	let isConfirmOpen = $state(false);

	// The fields are checked before asking, since the dialog covers them.
	function askToConfirm(event: MouseEvent) {
		if ((event.currentTarget as HTMLButtonElement).form?.reportValidity()) {
			isConfirmOpen = true;
		}
	}

	// A failed save keeps what was typed; the dialog closes once the server answers.
	const keepValues: SubmitFunction = () => {
		return async ({ update }) => {
			await update({ reset: false });
			isConfirmOpen = false;
		};
	};
</script>

<svelte:head>
	<title>
		{original ? 'Registrar movimiento contrario' : 'Registrar movimiento'} · Banquetes Consuelo C
	</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={CASH_TABS} current="Registrar movimiento" /></ScreenHeader>
	{/snippet}

	<UnsavedChangesGuard form="movement" />

	<form
		id="movement"
		class="movement"
		method="POST"
		use:enhance={keepValues}
		oninput={(event) => (entered = new FormData(event.currentTarget))}
	>
		{#if original}
			<div class="movement__correction">
				<Notice tone="info">{correctionNote(original)}</Notice>
			</div>
		{/if}
		<div class="form-stack">
			<fieldset class="choice">
				<legend class="choice__legend">Tipo</legend>
				<div class="choice__options">
					{#each DIRECTION_OPTIONS as [value, label] (value)}
						<Chip
							type="radio"
							name="direction"
							{value}
							{label}
							checked={value === (isInflow ? 'IN' : 'OUT')}
							disabled={null !== lockedDirection && value !== lockedDirection}
						/>
					{/each}
				</div>
				<p class="choice__hint">
					Concepto: {concept}{original ? ' · el tipo es el contrario del original' : ''}
				</p>
			</fieldset>

			{#if isStandalone}
				<Field
					label="Descripción"
					id="description"
					hint="Se imprime como «Concepto» en el {isInflow
						? 'recibo de caja'
						: 'comprobante de egreso'}."
					error={errorOf('description')}
				>
					<Input
						id="description"
						name="description"
						placeholder="Ej. Compra de jabón y desinfectante"
						value={original ? `Corrige el ${receiptName(original)}` : undefined}
						required
						aria-invalid={undefined !== errorOf('description')}
					/>
				</Field>

				<Field label={isInflow ? 'Recibido de' : 'Pagado a'} id="payee" error={errorOf('payee')}>
					<Input
						id="payee"
						name="payee"
						placeholder="Ej. Almacén Éxito Laureles"
						value={original?.payee ?? undefined}
						required
						aria-invalid={undefined !== errorOf('payee')}
					/>
				</Field>
			{/if}

			<fieldset class="choice">
				<legend class="choice__legend">Método</legend>
				<div class="choice__options">
					{#each METHOD_OPTIONS as [value, label] (value)}
						<Chip type="radio" name="payment_method" {value} {label} checked={value === method} />
					{/each}
				</div>
			</fieldset>

			{#if 'OTHER' === method}
				<Field label="¿Cuál medio de pago?" id="other_method" error={errorOf('other_method')}>
					<Input
						id="other_method"
						name="other_method"
						placeholder="Ej. Nequi"
						value={original?.otherMethod ?? undefined}
						required
						aria-invalid={undefined !== errorOf('other_method')}
					/>
				</Field>
			{/if}

			{#if !isInflow && 'TRANSFER' === method}
				<Field label="Cuenta de destino" id="bank_account" error={errorOf('bank_account')}>
					<Input
						id="bank_account"
						name="bank_account"
						placeholder="Ej. Bancolombia ahorros 123-456789-01"
						required
						aria-invalid={undefined !== errorOf('bank_account')}
					/>
				</Field>
			{/if}

			<div class="field-row">
				{#if original}
					<!-- The original's amount, not the form's: it isn't posted. -->
					<Field label="Valor" id="amount" hint="El del movimiento original.">
						<Input id="amount" value={formatInteger(amount)} readonly />
					</Field>
				{:else}
					<Field label="Valor" id="amount" error={errorOf('amount')}>
						<Input
							id="amount"
							name="amount"
							inputmode="numeric"
							placeholder="$0"
							required
							aria-invalid={undefined !== errorOf('amount')}
						/>
					</Field>
				{/if}
				<Field label="Fecha" id="movement_date" error={errorOf('movement_date')}>
					<Input
						id="movement_date"
						name="movement_date"
						type="date"
						value={data.today}
						required
						aria-invalid={undefined !== errorOf('movement_date')}
					/>
				</Field>
			</div>

			<Field label="Notas (opcional)" id="notes">
				<Input id="notes" name="notes" />
			</Field>
		</div>

		{#if form?.message}
			<div class="movement__notice">
				<Notice tone="error">{form.message}</Notice>
			</div>
		{/if}

		<div class="screen__action">
			<Button type="button" onclick={askToConfirm}>Guardar movimiento</Button>
		</div>
	</form>

	<Modal bind:open={isConfirmOpen} title="Confirmar movimiento" body={confirmation}>
		<p class="movement__question">¿Está seguro de que desea registrar este movimiento?</p>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isConfirmOpen = false)}>
				Cancelar
			</Button>
			<Button type="submit" form="movement" size="md">Confirmar</Button>
		{/snippet}
	</Modal>
</Screen>

{#snippet confirmation()}
	{concept} de <b>{formatPesos(amount)}</b> usando <b>{methodLabel}</b>
	{isInflow ? 'de' : 'a'} <b>{typed('payee', party)}</b>. Este movimiento
	<b>no se puede corregir</b>: para corregirlo se registra un movimiento contrario.
{/snippet}

<style>
	.movement {
		max-width: 560px;
		margin-inline: auto;
	}

	.choice {
		min-width: 0;
		padding: 0;
		margin: 0;
		border: 0;
	}

	/* The same look as a Field's label and hint. */
	.choice__legend {
		padding: 0;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	.choice__hint {
		margin: var(--space-3) 0 0;
		font-size: var(--text-label);
		font-style: italic;
		color: var(--text-secondary);
	}

	/* The options share the row, each a full tap target. */
	.choice__options {
		display: grid;
		grid-auto-columns: 1fr;
		grid-auto-flow: column;
		gap: var(--space-4);
	}

	.choice__options > :global(.chip) {
		justify-content: center;
		min-height: var(--tap-min);
	}

	/* A correction's Tipo is locked: the other option reads as unavailable. */
	.choice__options > :global(.chip:has(input:disabled)) {
		color: var(--text-disabled);
		cursor: default;
	}

	.movement__correction {
		margin-bottom: var(--field-gap);
	}

	.field-row {
		display: flex;
		gap: var(--control-gap);
	}

	.movement__notice {
		margin-top: var(--space-8);
	}

	.movement__question {
		margin: 0;
	}
</style>
