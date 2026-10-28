<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { INCIDENT_OUTCOME_LABELS } from '$lib/labels';
	import type { IncidentOutcome } from '$lib/server/services/incidents';
	import type { OrderItem } from '$lib/server/services/orders';
	import type { PageProps } from './$types';

	// Filled standing in the warehouse, counting what came back: quantities with − and +, the
	// outcome with chips. Only the order's lines, and the same product again with another outcome.
	// The service checks it all again; the confirmation says what leaves inventory.
	let { data, form }: PageProps = $props();

	const order = $derived(data.order);
	const backHref = $derived(
		`${resolve('/(app)/despachos/[id]', { id: String(order.id) })}${page.url.search}`
	);

	const OUTCOMES = Object.keys(INCIDENT_OUTCOME_LABELS) as IncidentOutcome[];
	const SUBTRACTING: readonly IncidentOutcome[] = ['LOST', 'UNRECOVERABLE'];

	type Row = { key: number; line: OrderItem; qty: number | null; outcome: IncidentOutcome | null };

	let rows = $state<Row[]>([]);
	let nextKey = 0;
	let isSheetOpen = $state(false);
	let isConfirmOpen = $state(false);

	function add(line: OrderItem) {
		rows.push({ key: nextKey++, line, qty: 1, outcome: null });
		isSheetOpen = false;
	}

	// What's left of the line for this row: the line's quantity minus the product's other rows.
	function room(row: Row): number {
		const others = rows.filter(
			(each) => each !== row && each.line.product_id === row.line.product_id
		);
		return row.line.qty - others.reduce((sum, each) => sum + (each.qty ?? 0), 0);
	}

	const payload = $derived(
		JSON.stringify(
			rows.map((row) => ({ product_id: row.line.product_id, qty: row.qty, outcome: row.outcome }))
		)
	);
	const subtracting = $derived(rows.filter((row) => SUBTRACTING.includes(row.outcome!)));
	const recoverable = $derived(rows.filter((row) => 'RECOVERABLE' === row.outcome));

	// The fields are checked before asking, since the dialog covers them. With no product there's
	// nothing to confirm: the service says what's missing.
	function askToConfirm(event: MouseEvent) {
		const incidentForm = (event.currentTarget as HTMLButtonElement).form;
		if (0 === rows.length) {
			incidentForm?.requestSubmit();
		} else if (incidentForm?.reportValidity()) {
			isConfirmOpen = true;
		}
	}

	// A refusal keeps what was typed; the dialog closes once the server answers.
	const keepValues: SubmitFunction = () => {
		return async ({ update }) => {
			await update({ reset: false });
			isConfirmOpen = false;
		};
	};

	const errorOf = (name: string): string | undefined => form?.errors?.[name];
</script>

<svelte:head>
	<title>Reportar novedad · Pedido #{order.id} · Banquetes Consuelo C</title>
</svelte:head>

{#snippet itemLine(row: Row)}
	<li>{row.qty} × {row.line.name} · {INCIDENT_OUTCOME_LABELS[row.outcome!]}</li>
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader title="Reportar novedad" {backHref} />
	{/snippet}

	<UnsavedChangesGuard form="incident" />

	<form id="incident" class="incident" method="POST" use:enhance={keepValues}>
		<p class="meta incident__lead">Pedido #{order.id} · {order.client.name}</p>
		<div class="incident__notice">
			<Notice tone="info">
				Perdido e Inservible descuentan del inventario. Recuperable no: se lava o se repara y vuelve
				a la bodega.
			</Notice>
		</div>

		<h2 class="section-title">Productos</h2>
		<input type="hidden" name="items" value={payload} />
		{#each rows as row, index (row.key)}
			<Card>
				{#snippet head()}
					<b class="item__name">{row.line.name}</b>
					<IconButton icon="trash" size="lg" label="Quitar" onclick={() => rows.splice(index, 1)} />
				{/snippet}
				<div class="stepper">
					<Button
						variant="secondary"
						inline
						type="button"
						aria-label="Menos"
						disabled={(row.qty ?? 0) <= 1}
						onclick={() => (row.qty = (row.qty ?? 0) - 1)}>−</Button
					>
					<input
						class="stepper__qty"
						type="number"
						inputmode="numeric"
						aria-label="Cantidad de {row.line.name}"
						min="1"
						max={room(row)}
						required
						aria-invalid={undefined !== errorOf(`items.${index}.qty`)}
						bind:value={row.qty}
					/>
					<Button
						variant="secondary"
						inline
						type="button"
						aria-label="Más"
						disabled={(row.qty ?? 0) >= room(row)}
						onclick={() => (row.qty = (row.qty ?? 0) + 1)}>+</Button
					>
					<span class="meta">de {row.line.qty} en el pedido</span>
				</div>
				<fieldset class="choice">
					<legend class="choice__legend">Resultado</legend>
					<div class="choice__options">
						{#each OUTCOMES as outcome (outcome)}
							<Chip
								type="radio"
								name="outcome-{row.key}"
								value={outcome}
								label={INCIDENT_OUTCOME_LABELS[outcome]}
								checked={outcome === row.outcome}
								required
								onchange={() => (row.outcome = outcome)}
							/>
						{/each}
					</div>
					{#if row.outcome}
						<p
							class={['choice__hint', SUBTRACTING.includes(row.outcome) && 'choice__hint--strong']}
						>
							{SUBTRACTING.includes(row.outcome)
								? `Descuenta ${row.qty ?? 0} del inventario`
								: 'No descuenta del inventario'}
						</p>
					{/if}
				</fieldset>
				{#each ['product_id', 'qty', 'outcome'] as key (key)}
					{@const message = errorOf(`items.${index}.${key}`)}
					{#if message}
						<p class="item__error">{message}</p>
					{/if}
				{/each}
			</Card>
		{/each}
		<Button variant="secondary" type="button" onclick={() => (isSheetOpen = true)}>
			+ Agregar producto del pedido
		</Button>
		{#if errorOf('items')}
			<p class="item__error">{errorOf('items')}</p>
		{/if}

		<div class="incident__section">
			<Field
				label="Descripción"
				id="incident_description"
				hint="Obligatoria."
				error={errorOf('incident_description')}
			>
				<textarea
					class="description"
					id="incident_description"
					name="incident_description"
					rows="3"
					required
					aria-invalid={undefined !== errorOf('incident_description')}></textarea>
			</Field>
		</div>

		<div class="incident__section">
			<ul class="detail-list">
				<li class="detail-list__row--plain"><span>Responsable</span><span>Por determinar</span></li>
			</ul>
			<p class="note incident__responsible">
				Lo define un Gerente o Administrador desde el pedido.
			</p>
		</div>

		{#if form?.message}
			<div class="incident__section">
				<Notice tone="error">{form.message}</Notice>
			</div>
		{/if}

		<div class="screen__action">
			<Button type="button" onclick={askToConfirm}>Guardar novedad</Button>
		</div>
	</form>
</Screen>

<BottomSheet bind:open={isSheetOpen} title="Agregar producto">
	<p class="meta sheet__lead">Solo los productos de este pedido.</p>
	<div class="results">
		{#each order.items as line (line.product_id)}
			<button class="result" type="button" onclick={() => add(line)}>
				<span class="result__text">
					<span>{line.name}</span>
					<span class="meta">{line.qty} en el pedido</span>
				</span>
				<Icon name="plus" size="sm" />
			</button>
		{/each}
	</div>
</BottomSheet>

<Modal
	bind:open={isConfirmOpen}
	title="¿Guardar la novedad del pedido #{order.id}?"
	body={0 < subtracting.length
		? 'Descuenta del inventario:'
		: 'El inventario no cambia: todo es recuperable.'}
>
	<ul class="confirm__items">
		{#each 0 < subtracting.length ? subtracting : recoverable as row (row.key)}
			{@render itemLine(row)}
		{/each}
	</ul>
	{#if 0 < subtracting.length}
		{#each recoverable as row (row.key)}
			<p class="confirm__text">{row.qty} × {row.line.name} · Recuperable: no descuenta.</p>
		{/each}
	{:else}
		<p class="confirm__text">
			Lo recuperable se lava o se repara y vuelve a la bodega; se verifica en el próximo conteo.
		</p>
	{/if}
	<p class="confirm__text">
		Un Gerente o Administrador puede revertirla después; un pago, en cambio, no se puede corregir.
	</p>
	{#snippet actions()}
		<Button type="button" variant="secondary" onclick={() => (isConfirmOpen = false)}>
			Cancelar
		</Button>
		<Button type="submit" form="incident" size="md">Guardar novedad</Button>
	{/snippet}
</Modal>

<style>
	p {
		margin: 0;
	}

	.incident__lead {
		margin-bottom: var(--space-6);
	}

	.incident__notice {
		margin-bottom: var(--space-9);
	}

	.incident__section {
		margin-top: var(--space-10);
	}

	.incident__responsible {
		margin-top: var(--space-3);
	}

	.item__name {
		font-size: var(--text-base);
	}

	.item__error {
		margin-top: var(--space-3);
		font-size: var(--text-label);
		font-weight: var(--weight-semibold);
		color: var(--error-fg);
	}

	/* − and + as 48px squares around the count, for a thumb in the warehouse. */
	.stepper {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		margin-top: var(--space-3);
	}

	.stepper > :global(.btn) {
		width: var(--tap-min);
		height: var(--tap-min);
		padding: 0;
		font-size: 22px;
	}

	.stepper__qty {
		box-sizing: border-box;
		width: 72px;
		height: var(--tap-min);
		padding: 0;
		font: var(--type-input);
		font-weight: var(--weight-bold);
		color: var(--text-body);
		text-align: center;
		appearance: textfield;
		outline: none;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-input);
	}

	.stepper__qty::-webkit-inner-spin-button {
		appearance: none;
	}

	.stepper__qty:focus-visible {
		border-color: var(--border-strong);
	}

	.stepper__qty[aria-invalid='true'] {
		border-color: var(--error-fg);
	}

	.choice {
		min-width: 0;
		padding: 0;
		margin: var(--space-6) 0 0;
		border: 0;
	}

	/* The same look as a Field's label. */
	.choice__legend {
		padding: 0;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	/* The three outcomes share the row, each a full tap target. */
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

	.choice__hint {
		margin-top: var(--space-3);
		font-size: var(--text-label);
		color: var(--text-secondary);
	}

	/* What leaves inventory reads louder than what doesn't. */
	.choice__hint--strong {
		font-weight: var(--weight-semibold);
		color: var(--text-body);
	}

	.description {
		box-sizing: border-box;
		width: 100%;
		padding: var(--space-6) var(--space-7);
		margin: 0;
		font: var(--type-input);
		color: var(--text-body);
		resize: vertical;
		outline: none;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-input);
	}

	.description:focus-visible {
		border-color: var(--border-strong);
	}

	.description[aria-invalid='true'] {
		border-color: var(--error-fg);
	}

	.sheet__lead {
		margin-bottom: var(--space-5);
	}

	.results {
		max-height: 60vh;
		overflow: auto;
		border-top: var(--border-w-hair) solid var(--border-default);
	}

	.result {
		box-sizing: border-box;
		display: flex;
		gap: var(--space-6);
		align-items: center;
		width: 100%;
		min-height: 56px;
		padding: var(--space-4) 0;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		background: var(--surface-card);
		border: 0;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.result__text {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		font-size: var(--text-base);
	}

	.confirm__items {
		padding-left: var(--space-9);
		margin: 0;
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
		line-height: 1.5;
	}

	.confirm__text {
		margin-top: var(--space-4);
		font: var(--type-body);
	}
</style>
