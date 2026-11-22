<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Badge, { INVENTORY_COUNT_STATUS_TONES } from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatInstant } from '$lib/datetime';
	import { formatInteger } from '$lib/format';
	import { INVENTORY_COUNT_STATUS_LABELS } from '$lib/labels';
	import type { ApprovalPreview, InventoryItem } from '$lib/server/services/inventory';
	import OverlapNotice from '../../OverlapNotice.svelte';
	import type { PageProps } from './$types';

	// A pending count is reviewed against the system as it is now: a product that moved since it
	// was counted is stale, and approving skips it. The reviewer corrects or deletes rows, never adds
	// one, and nothing is saved until they approve. A reviewed count is read-only.
	let { data, form }: PageProps = $props();

	const count = $derived(data.count);
	const preview = $derived(count.preview);
	const title = $derived(`Conteo #${count.id}`);

	let corrected = $state<Record<number, number | null | undefined>>({});
	let removed = $state<Record<number, boolean>>({});
	// What approving would do with the edits, asked of the server when «Aprobar» is pressed.
	let approval = $state<ApprovalPreview | null>(null);
	let approvalMessage = $state('');

	const staleById = $derived(new Map(preview?.stale.map((item) => [item.product_id, item])));
	const isNothingApplied = $derived(
		count.items.every((item) => staleById.has(item.product_id) || removed[item.product_id])
	);
	type Edit = { product_id: number; removed: true } | { product_id: number; corrected_qty: number };
	const edits = $derived(
		count.items.flatMap((item): Edit[] => {
			if (removed[item.product_id]) {
				return [{ product_id: item.product_id, removed: true }];
			}
			const quantity = corrected[item.product_id];
			return 'number' === typeof quantity
				? [{ product_id: item.product_id, corrected_qty: quantity }]
				: [];
		})
	);

	// A reviewed count's items: what was applied, what was skipped as stale, and what was deleted.
	const applied = $derived(count.items.filter((item) => item.applied));
	const changed = $derived(applied.filter((item) => appliedQuantity(item) !== item.system_qty));
	const skipped = $derived(count.items.filter((item) => false === item.applied && !item.removed));
	const deleted = $derived(count.items.filter((item) => item.removed));

	let isApproveOpen = $state(false);
	let isRejectOpen = $state(false);
	let isReverseOpen = $state(false);
	let note = $state('');
	let reason = $state('');

	function appliedQuantity(item: InventoryItem): number {
		return item.corrected_qty ?? item.counted_qty;
	}

	// The figure approving would apply to a pending row: what the reviewer typed, else the count.
	function reviewedQuantity(item: InventoryItem): number {
		const quantity = corrected[item.product_id];
		return 'number' === typeof quantity ? quantity : item.counted_qty;
	}

	// Deleting has no typing in it, so it tells the unsaved-changes guard itself.
	function toggleRemoved(event: MouseEvent, item: InventoryItem) {
		removed[item.product_id] = !removed[item.product_id];
		event.currentTarget?.dispatchEvent(new Event('input', { bubbles: true }));
	}

	async function askToApprove() {
		const response = await fetch(resolve('/inventario/aprobacion'), {
			method: 'POST',
			body: JSON.stringify({ id: count.id, edits })
		});
		const answer: ApprovalPreview | { message: string } = await response.json();
		if ('message' in answer) {
			approvalMessage = answer.message;
			return;
		}
		approvalMessage = '';
		approval = answer;
		isApproveOpen = true;
	}

	function appliedText(item: InventoryItem): string {
		const counted = `Sistema ${formatInteger(item.system_qty)} · Contado ${formatInteger(item.counted_qty)}`;
		return undefined === item.corrected_qty
			? counted
			: `${counted} · Corregido ${formatInteger(item.corrected_qty)}`;
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
		<UnsavedChangesGuard form="approve" />
		<table class="table">
			<thead>
				<tr>
					<th>Producto</th>
					<th class="num">Sistema</th>
					<th class="num">Contado</th>
					<th class="num">Corregido</th>
					<th aria-label="Eliminar"></th>
				</tr>
			</thead>
			<tbody>
				{#each count.items as item (item.product_id)}
					{@const stale = staleById.get(item.product_id)}
					{@const current = stale?.current ?? item.system_qty}
					{@const isRemoved = removed[item.product_id]}
					{@const difference = reviewedQuantity(item) - current}
					<tr class={{ removed: isRemoved }}>
						<td>
							<span class="name">{item.name}</span>
							{#if isRemoved}
								<div class="badge-line"><Badge>Eliminado</Badge></div>
							{:else if stale}
								<div class="badge-line"><Badge tone="warning">Desactualizado</Badge></div>
								<div class="meta">
									Al contar: {formatInteger(stale.system_qty)} · Ahora: {formatInteger(
										stale.current
									)}
								</div>
							{:else}
								<div class={['meta', { difference: 0 !== difference }]}>
									Diferencia {signed(difference)}
								</div>
							{/if}
						</td>
						<td class="num">{formatInteger(current)}</td>
						<td class="num">{formatInteger(item.counted_qty)}</td>
						<td class="num">
							{#if !stale && !isRemoved}
								<Input
									id="corrected-{item.product_id}"
									form="approve"
									type="number"
									inputmode="numeric"
									min="0"
									step="1"
									autocomplete="off"
									aria-label="Corregido de {item.name}"
									placeholder={String(item.counted_qty)}
									bind:value={corrected[item.product_id]}
								/>
							{/if}
						</td>
						<td class="remove">
							{#if isRemoved}
								<Button
									type="button"
									variant="secondary"
									form="approve"
									onclick={(event) => toggleRemoved(event, item)}
								>
									Deshacer
								</Button>
							{:else}
								<IconButton
									icon="trash"
									size="lg"
									form="approve"
									label="Eliminar {item.name}"
									onclick={(event) => toggleRemoved(event, item)}
								/>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="note after">
			«Corregido» vacío aplica lo contado. Las filas desactualizadas no se aplican.
		</p>
		{#if isNothingApplied}
			<p class="note after">
				No puedes aprobarlo: todos los productos están desactualizados o eliminados. Recházalo y
				pide un conteo nuevo.
			</p>
		{/if}
		{#if approvalMessage}
			<div class="after"><Notice tone="error">{approvalMessage}</Notice></div>
		{/if}
		<div class="screen__action actions">
			<Button type="button" variant="secondary" onclick={() => (isRejectOpen = true)}>
				Rechazar
			</Button>
			<Button type="button" size="md" disabled={isNothingApplied} onclick={askToApprove}>
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
				'REVERSED' === count.status ? 'Aplicados y revertidos' : 'Aplicados',
				applied,
				appliedText
			)}
			{@render itemGroup(
				'Desactualizados, sin aplicar',
				skipped,
				(item) =>
					`Contado ${formatInteger(item.counted_qty)} · Sistema ${formatInteger(item.system_qty)}`
			)}
			{@render itemGroup(
				'Eliminados del conteo',
				deleted,
				(item) => `Contado ${formatInteger(item.counted_qty)}`
			)}
		{/if}

		{#if 'APPROVED' === count.status}
			{#if null === count.reversalBlock}
				<div class="screen__action actions">
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
		body={approval?.changes.length
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
			<input type="hidden" name="edits" value={JSON.stringify(edits)} />
			{#if approval?.changes.length}
				<ul class="changes">
					{#each approval.changes as change (change.product_id)}
						<li>
							{change.name}: {formatInteger(change.from)} → {formatInteger(change.to)}
							{#if change.isCorrected}<span class="corrected">(corregido)</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if approval?.stale.length}
				<p>No se aplica, porque está desactualizado: {names(approval.stale)}.</p>
			{/if}
			{#if approval?.removed.length}
				<p>No se aplica, porque lo eliminaste: {names(approval.removed)}.</p>
			{/if}
			{#if approval?.overlaps.length}
				<OverlapNotice overlaps={approval.overlaps} />
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
							{item.name}: {formatInteger(appliedQuantity(item))} → {formatInteger(item.system_qty)}
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

	.badge-line {
		margin-top: var(--space-2);
	}

	.difference {
		font-weight: var(--weight-bold);
		color: var(--text-body);
	}

	.removed .name,
	.removed td.num {
		color: var(--text-secondary);
		text-decoration: line-through;
	}

	.remove {
		width: 1%;
		text-align: right;
		white-space: nowrap;
	}

	.table td.num :global(.input) {
		width: 6em;
		text-align: right;
	}

	.corrected {
		font-weight: var(--weight-regular);
		color: var(--text-secondary);
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
