<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Choice from '$lib/components/Choice.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatInstantTime, formatShortDay, getInstantDate } from '$lib/datetime';
	import { INCIDENT_OUTCOME_LABELS } from '$lib/labels';
	import type { Incident, IncidentOutcome } from '$lib/server/services/incidents';
	import type { OrderDetail, OrderItem } from '$lib/server/services/orders';

	// Filled standing in the warehouse, counting what came back: quantities with − and +, the
	// outcome with chips. Only the order's lines, and the same product again with another outcome.
	// The service checks it all again; the confirmation says what leaves inventory. Given an
	// `incident`, it's that incident's correction: pre-filled, and saying what each product's
	// change gives back or takes.
	interface Props {
		order: OrderDetail;
		incident?: Incident;
		form: { message?: string; errors?: Record<string, string> } | null | undefined;
	}

	let { order, incident, form }: Props = $props();
	const backHref = $derived(
		`${resolve('/(app)/despachos/[id]', { id: String(order.id) })}${page.url.search}`
	);

	const OUTCOMES = Object.keys(INCIDENT_OUTCOME_LABELS) as IncidentOutcome[];
	const SUBTRACTING: readonly IncidentOutcome[] = ['LOST', 'UNRECOVERABLE'];

	type Row = { key: number; line: OrderItem; qty: number | null; outcome: IncidentOutcome | null };

	// A line removed from the order since leaves its rows out: there's nothing left to report on.
	function prefilledRows(): Row[] {
		return (incident?.items ?? []).flatMap((item, key) => {
			const line = order.items.find((each) => each.product_id === item.product_id);
			return undefined === line ? [] : [{ key, line, qty: item.qty, outcome: item.outcome }];
		});
	}

	function prefilledKeyCount(): number {
		return incident?.items.length ?? 0;
	}

	let rows = $state<Row[]>(prefilledRows());
	// Past every pre-filled key, even those left out.
	let nextKey = prefilledKeyCount();
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

	function isSubtracting(row: Row): boolean {
		return SUBTRACTING.includes(row.outcome!);
	}

	function outcomeHint(row: Row): string | undefined {
		if (null === row.outcome) {
			return undefined;
		}
		return isSubtracting(row)
			? `Descuenta ${row.qty ?? 0} del inventario`
			: 'No descuenta del inventario';
	}

	const payload = $derived(
		JSON.stringify(
			rows.map((row) => ({ product_id: row.line.product_id, qty: row.qty, outcome: row.outcome }))
		)
	);
	const subtracting = $derived(rows.filter(isSubtracting));

	// Each product's LOST + UNRECOVERABLE total, the inventory it takes.
	function takenByProduct(
		items: { product_id: number; qty: number; outcome: IncidentOutcome | null }[]
	): Record<number, number> {
		const totals: Record<number, number> = {};
		for (const item of items.filter((each) => SUBTRACTING.includes(each.outcome!))) {
			totals[item.product_id] = (totals[item.product_id] ?? 0) + item.qty;
		}
		return totals;
	}

	const takenBefore = $derived(takenByProduct(incident?.items ?? []));
	const takenNow = $derived(
		takenByProduct(
			rows.map((row) => ({
				product_id: row.line.product_id,
				qty: row.qty ?? 0,
				outcome: row.outcome
			}))
		)
	);

	function stockChange(before: number, now: number): string {
		if (before > now) {
			return `devuelve ${before - now} al inventario`;
		}
		return before < now
			? `descuenta ${now - before} más del inventario`
			: 'el inventario no cambia';
	}

	// Once per product, on its first row, for a product the incident took or now takes.
	function correctionHint(row: Row): string | undefined {
		const productId = row.line.product_id;
		const isFirst = rows.find((each) => each.line.product_id === productId) === row;
		const before = takenBefore[productId] ?? 0;
		const now = takenNow[productId] ?? 0;
		if (undefined === incident || !isFirst || (0 === before && 0 === now)) {
			return undefined;
		}
		return `Antes ${before} · ${stockChange(before, now)}`;
	}

	// The confirmation's line: «Silla Tiffany dorada: vuelven 2».
	function stockChangeLine({ name, before, now }: { name: string; before: number; now: number }) {
		return before > now ? `${name}: vuelven ${before - now}` : `${name}: salen ${now - before} más`;
	}

	// The hint under Resultado: a correction says what the product's change does, a report what
	// the outcome does.
	function resultHint(row: Row): string | undefined {
		return correctionHint(row) ?? outcomeHint(row);
	}

	function isResultHintStrong(row: Row): boolean {
		return undefined !== correctionHint(row) || isSubtracting(row);
	}

	const lead = $derived(
		undefined === incident
			? `Pedido #${order.id} · ${order.client.name}`
			: `Pedido #${order.id} · ${order.client.name} · reportada ${formatShortDay(getInstantDate(incident.reportedAt))} · ${formatInstantTime(incident.reportedAt)}`
	);

	// What the correction does to the inventory, product by product, the removed ones included.
	const stockChanges = $derived(
		[...new Set([...Object.keys(takenBefore), ...Object.keys(takenNow)].map(Number))]
			.map((productId) => ({
				productId,
				name: order.items.find((line) => line.product_id === productId)?.name ?? '',
				before: takenBefore[productId] ?? 0,
				now: takenNow[productId] ?? 0
			}))
			.filter((change) => change.before !== change.now)
	);
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
	<title
		>{incident ? 'Corregir' : 'Reportar'} novedad · Pedido #{order.id} · Banquetes Consuelo C</title
	>
</svelte:head>

{#snippet itemLine(row: Row)}
	<li>{row.qty} × {row.line.name} · {INCIDENT_OUTCOME_LABELS[row.outcome!]}</li>
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader title={incident ? 'Corregir novedad' : 'Reportar novedad'} {backHref} />
	{/snippet}

	<UnsavedChangesGuard form="incident" />

	<form id="incident" class="incident" method="POST" use:enhance={keepValues}>
		<p class="meta incident__lead">{lead}</p>
		<div class="incident__notice">
			{#if incident}
				<Notice tone="info">
					Al guardar, el inventario se ajusta a la diferencia con lo que reportaste.
				</Notice>
			{:else}
				<Notice tone="info">
					Perdido e Inservible descuentan del inventario. Recuperable no: se lava o se repara y
					vuelve a la bodega.
				</Notice>
			{/if}
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
				<Choice legend="Resultado" hint={resultHint(row)} strongHint={isResultHintStrong(row)}>
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
				</Choice>
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
					value={incident?.description ?? ''}
					aria-invalid={undefined !== errorOf('incident_description')}></textarea>
			</Field>
		</div>

		{#if undefined === incident}
			<div class="incident__section">
				<ul class="detail-list">
					<li class="detail-list__row--plain">
						<span>Responsable</span><span>Por determinar</span>
					</li>
				</ul>
				<p class="note incident__responsible">
					Lo define un Gerente o Administrador desde el pedido.
				</p>
			</div>
		{/if}

		{#if form?.message}
			<div class="incident__section">
				<Notice tone="error">{form.message}</Notice>
			</div>
		{/if}

		<div class="screen__action">
			<Button type="button" onclick={askToConfirm}>
				{incident ? 'Guardar corrección' : 'Guardar novedad'}
			</Button>
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
				<Icon name="plus" />
			</button>
		{/each}
	</div>
</BottomSheet>

{#if incident}
	<Modal
		bind:open={isConfirmOpen}
		title="Guardar corrección"
		body={0 < stockChanges.length ? 'Cambia el inventario:' : 'El inventario no cambia.'}
	>
		{#if stockChanges.length}
			<ul class="confirm__items">
				{#each stockChanges as change (change.productId)}
					<li>{stockChangeLine(change)}</li>
				{/each}
			</ul>
		{/if}
		<p class="confirm__text">Puedes corregirla mientras el Gerente no le ponga responsable.</p>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isConfirmOpen = false)}>
				Volver
			</Button>
			<Button type="submit" form="incident" size="md">Guardar</Button>
		{/snippet}
	</Modal>
{:else}
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
{/if}

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
		margin: var(--space-3) 0 var(--space-6);
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
