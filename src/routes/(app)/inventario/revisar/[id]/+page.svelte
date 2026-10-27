<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Badge, { INVENTORY_COUNT_STATUS_TONES } from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatInstant } from '$lib/datetime';
	import { formatInteger } from '$lib/format';
	import { INVENTORY_COUNT_STATUS_LABELS } from '$lib/labels';
	import type { InventoryItem } from '$lib/server/services/inventory';
	import OverlapNotice from '../../OverlapNotice.svelte';
	import type { PageProps } from './$types';

	// A pending count is reviewed against the system as it is now: a product that moved since it
	// was counted is stale, and approving skips it. A reviewed count is read-only.
	let { data, form }: PageProps = $props();

	const count = $derived(data.count);
	const preview = $derived(count.preview);
	const title = $derived(`Conteo #${count.id}`);

	const staleById = $derived(new Map(preview?.stale.map((item) => [item.product_id, item])));
	const isAllStale = $derived(count.items.every((item) => staleById.has(item.product_id)));

	// A reviewed count's items: what changed on approval, what didn't, and what was skipped.
	const changed = $derived(count.items.filter((item) => item.applied && isDifferent(item)));
	const unchanged = $derived(count.items.filter((item) => item.applied && !isDifferent(item)));
	const skipped = $derived(count.items.filter((item) => false === item.applied));

	let isApproveOpen = $state(false);
	let isRejectOpen = $state(false);
	let isReverseOpen = $state(false);
	let note = $state('');
	let reason = $state('');

	function isDifferent(item: InventoryItem): boolean {
		return item.counted_qty !== item.system_qty;
	}

	function signed(difference: number): string {
		if (0 < difference) {
			return `+${formatInteger(difference)}`;
		}
		return 0 > difference ? `−${formatInteger(-difference)}` : '0';
	}

	function names(items: { name: string }[]): string {
		return items.map(({ name }) => name).join(', ');
	}

	function closeOnSuccess(close: () => void): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if ('success' === result.type) {
					close();
				}
				await update({ reset: false });
			};
	}
</script>

<svelte:head>
	<title>{title} · Banquetes Consuelo C</title>
</svelte:head>

{#snippet itemGroup(
	groupTitle: string,
	items: InventoryItem[],
	value: (item: InventoryItem) => string
)}
	{#if items.length}
		<h2 class="section-title group">{groupTitle}</h2>
		<ul class="detail-list">
			{#each items as item (item.product_id)}
				<li><span>{item.name}</span><span>{value(item)}</span></li>
			{/each}
		</ul>
	{/if}
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader backHref={resolve('/(app)/inventario/revisar')} {title}>
			<Badge tone={INVENTORY_COUNT_STATUS_TONES[count.status]}>
				{INVENTORY_COUNT_STATUS_LABELS[count.status]}
			</Badge>
		</ScreenHeader>
	{/snippet}

	{#if form?.approved}
		<div class="lead"><Notice tone="success">Conteo aprobado: el inventario cambió.</Notice></div>
	{:else if form?.rejected}
		<div class="lead">
			<Notice tone="success">Conteo rechazado: el inventario no cambió.</Notice>
		</div>
	{:else if form?.reversed}
		<div class="lead">
			<Notice tone="success"
				>Conteo revertido: los productos volvieron a su cantidad anterior.</Notice
			>
		</div>
	{/if}

	<p class="meta lead">Contó {count.createdBy} · {formatInstant(count.createdAt)}</p>

	{#if preview}
		{#if preview.overlaps.length}
			<div class="lead"><OverlapNotice overlaps={preview.overlaps} /></div>
		{/if}
		<table class="table">
			<thead>
				<tr>
					<th>Producto</th>
					<th class="num">Sistema</th>
					<th class="num">Contado</th>
					<th class="num">Diferencia</th>
				</tr>
			</thead>
			<tbody>
				{#each count.items as item (item.product_id)}
					{@const stale = staleById.get(item.product_id)}
					{@const current = stale?.current ?? item.system_qty}
					<tr>
						<td>
							{item.name}
							{#if stale}
								<div class="stale"><Badge tone="warning">Desactualizado</Badge></div>
								<div class="meta">
									Al contar: {formatInteger(stale.system_qty)} · Ahora: {formatInteger(
										stale.current
									)}
								</div>
							{/if}
						</td>
						<td class="num">{formatInteger(current)}</td>
						<td class="num">{formatInteger(item.counted_qty)}</td>
						<td class={['num', { 'num--same': stale || item.counted_qty === current }]}>
							{stale ? '—' : signed(item.counted_qty - current)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if preview.stale.length}
			<p class="note after">
				No se aplica, porque su inventario cambió después del conteo: {names(preview.stale)}. Pide
				un conteo nuevo.
			</p>
		{/if}
		{#if isAllStale}
			<p class="note after">
				No puedes aprobarlo: todos los productos están desactualizados. Recházalo y pide un conteo
				nuevo.
			</p>
		{/if}
		<div class="actions actions--row">
			<Button type="button" variant="secondary" onclick={() => (isRejectOpen = true)}>
				Rechazar
			</Button>
			<Button type="button" size="md" disabled={isAllStale} onclick={() => (isApproveOpen = true)}>
				Aprobar
			</Button>
		</div>
	{:else}
		<ul class="detail-list">
			{#if count.reviewedBy && count.reviewedAt}
				<li>
					<span>{'REJECTED' === count.status ? 'Rechazó' : 'Aprobó'}</span>
					<span>{count.reviewedBy} · {formatInstant(count.reviewedAt)}</span>
				</li>
			{/if}
			{#if count.reversedBy && count.reversedAt}
				<li>
					<span>Revirtió</span><span>{count.reversedBy} · {formatInstant(count.reversedAt)}</span>
				</li>
			{/if}
		</ul>
		{#if count.reviewNote}
			<h2 class="section-title group">Nota</h2>
			<p class="text">{count.reviewNote}</p>
		{/if}
		{#if count.reversalReason}
			<h2 class="section-title group">Motivo de la reversión</h2>
			<p class="text">{count.reversalReason}</p>
		{/if}

		{#if 'REJECTED' === count.status}
			{@render itemGroup(
				'Productos',
				count.items,
				(item) =>
					`Contado ${formatInteger(item.counted_qty)} · Sistema ${formatInteger(item.system_qty)}`
			)}
		{:else}
			{@render itemGroup(
				'REVERSED' === count.status ? 'Cambió y se revirtió' : 'Cambió',
				changed,
				(item) => `${formatInteger(item.system_qty)} → ${formatInteger(item.counted_qty)}`
			)}
			{@render itemGroup('Sin cambio', unchanged, (item) => formatInteger(item.system_qty))}
			{@render itemGroup(
				'No se aplicó: desactualizado',
				skipped,
				(item) =>
					`Contado ${formatInteger(item.counted_qty)} · Sistema ${formatInteger(item.system_qty)}`
			)}
		{/if}

		{#if 'APPROVED' === count.status}
			{#if null === count.reversalBlock}
				<div class="actions">
					<Button type="button" variant="secondary" onclick={() => (isReverseOpen = true)}>
						Revertir
					</Button>
				</div>
				<p class="note">Se puede revertir mientras sea el último movimiento de estos productos.</p>
			{:else}
				<p class="note actions">No se puede revertir: {count.reversalBlock}.</p>
			{/if}
		{/if}
	{/if}
</Screen>

{#if preview}
	<Modal
		bind:open={isApproveOpen}
		title="Aprobar conteo #{count.id}"
		body={preview.changes.length
			? 'Cambia el inventario:'
			: 'El inventario no cambia: lo contado coincide con el sistema.'}
	>
		<form
			id="approve"
			class="form-stack"
			method="POST"
			action="?/aprobar"
			use:enhance={closeOnSuccess(() => (isApproveOpen = false))}
		>
			{#if preview.changes.length}
				<ul class="changes">
					{#each preview.changes as change (change.product_id)}
						<li>{change.name}: {formatInteger(change.from)} → {formatInteger(change.to)}</li>
					{/each}
				</ul>
			{/if}
			{#if preview.stale.length}
				<p>No se aplica, porque está desactualizado: {names(preview.stale)}.</p>
			{/if}
			{#if preview.overlaps.length}
				<OverlapNotice overlaps={preview.overlaps} />
			{/if}
			<Field label="Nota (opcional)" id="approve-note">
				<textarea
					class="textarea"
					id="approve-note"
					name="note"
					rows="2"
					placeholder="Ej. Cuadra con lo que volvió del #1047"
					bind:value={note}></textarea>
			</Field>
			<p class="note">
				Un Gerente o Administrador puede revertirlo mientras sea el último movimiento de estos
				productos.
			</p>
			{#if form?.approveMessage}
				<Notice tone="error">{form.approveMessage}</Notice>
			{/if}
		</form>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isApproveOpen = false)}>
				Volver
			</Button>
			<Button type="submit" form="approve" size="md">Aprobar conteo</Button>
		{/snippet}
	</Modal>

	<Modal
		bind:open={isRejectOpen}
		title="Rechazar conteo #{count.id}"
		body="El inventario no cambia. El conteo queda como Rechazado, con tu nota."
	>
		<form
			id="reject"
			class="form-stack"
			method="POST"
			action="?/rechazar"
			use:enhance={closeOnSuccess(() => (isRejectOpen = false))}
		>
			<Field label="Nota (opcional)" id="reject-note">
				<textarea
					class="textarea"
					id="reject-note"
					name="note"
					rows="2"
					placeholder="Ej. Faltó sumar lo que está en alquiler"
					bind:value={note}></textarea>
			</Field>
			{#if form?.rejectMessage}
				<Notice tone="error">{form.rejectMessage}</Notice>
			{/if}
		</form>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isRejectOpen = false)}>
				Volver
			</Button>
			<Button type="submit" form="reject" size="md">Rechazar conteo</Button>
		{/snippet}
	</Modal>
{/if}

{#if 'APPROVED' === count.status && null === count.reversalBlock}
	<Modal
		bind:open={isReverseOpen}
		title="Revertir conteo #{count.id}"
		body={changed.length
			? 'Vuelven a su cantidad anterior:'
			: 'El inventario no cambia: ningún producto cambió al aprobarlo.'}
	>
		<form
			id="reverse"
			class="form-stack"
			method="POST"
			action="?/revertir"
			use:enhance={closeOnSuccess(() => (isReverseOpen = false))}
		>
			{#if changed.length}
				<ul class="changes">
					{#each changed as item (item.product_id)}
						<li>
							{item.name}: {formatInteger(item.counted_qty)} → {formatInteger(item.system_qty)}
						</li>
					{/each}
				</ul>
			{/if}
			<Field label="Motivo" id="reverse-reason" error={form?.reverseMessage}>
				<textarea
					class="textarea"
					id="reverse-reason"
					name="reason"
					rows="3"
					placeholder="Ej. Se contaron los platos de otra bodega"
					aria-invalid={form?.reverseMessage ? 'true' : undefined}
					required
					bind:value={reason}></textarea>
			</Field>
		</form>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isReverseOpen = false)}>
				Volver
			</Button>
			<Button type="submit" form="reverse" size="md" disabled={'' === reason.trim()}>
				Revertir conteo
			</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	p {
		margin: 0;
	}

	.lead {
		margin-bottom: var(--space-7);
	}

	.group {
		margin-top: var(--space-9);
	}

	.text {
		font-size: var(--text-md);
		line-height: 1.4;
	}

	.after {
		margin-top: var(--space-4);
	}

	.actions {
		margin: var(--space-10) 0 var(--space-4);
	}

	.actions--row {
		display: flex;
		gap: var(--control-gap);
	}

	.stale {
		margin-top: var(--space-2);
	}

	.changes {
		padding-left: var(--space-8);
		margin: 0;
		font-weight: var(--weight-semibold);
	}

	.table {
		width: 100%;
		font-size: var(--text-md);
		border-collapse: collapse;
	}

	.table th {
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-label);
		font-weight: var(--weight-bold);
		line-height: 1.5;
		color: var(--text-secondary);
		text-align: left;
		border-bottom: var(--border-w-strong) solid var(--border-strong);
	}

	.table td {
		padding: var(--space-4);
		vertical-align: top;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	td.num:last-child {
		font-weight: var(--weight-bold);
	}

	td.num--same:last-child {
		font-weight: var(--weight-regular);
		color: var(--text-secondary);
	}

	.textarea {
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

	.textarea:focus-visible {
		border-color: var(--border-strong);
	}

	.textarea[aria-invalid='true'] {
		border-color: var(--error-fg);
	}
</style>
