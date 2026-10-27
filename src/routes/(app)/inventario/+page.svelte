<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { fold, formatInteger } from '$lib/format';
	import { INVENTORY_TABS } from '$lib/navigation';
	import type {
		ApprovalPreview,
		CountableProduct,
		SuggestedProduct
	} from '$lib/server/services/inventory';
	import { moveThroughResults } from '../pedidos/order-form';
	import OverlapNotice from './OverlapNotice.svelte';
	import type { PageProps } from './$types';

	// Filled standing in the warehouse, on a phone: the suggested products first, any other active
	// one added from the search. What's typed is the total the company owns, so each row hints what
	// the system says and what's out on rent. A blank row isn't counted. The service checks it all.
	let { data, form }: PageProps = $props();

	let added = $state<CountableProduct[]>([]);
	let counted = $state<Record<number, number | undefined>>({});
	let query = $state('');
	let note = $state('');
	let countForm = $state<HTMLFormElement>();
	let isSendOpen = $state(false);
	let isApproveOpen = $state(false);
	let preview = $state<ApprovalPreview | null>(null);
	let previewMessage = $state('');
	let resultList = $state<HTMLElement>();

	const SEARCH_ID = 'product-search';

	const onScreen = $derived([...data.suggested, ...added]);
	const typed = $derived(onScreen.filter((product) => isTyped(product.product_id)));
	const items = $derived(
		typed.map((product) => ({
			product_id: product.product_id,
			counted_qty: counted[product.product_id]
		}))
	);
	const productCount = $derived(`${typed.length} ${1 === typed.length ? 'producto' : 'productos'}`);
	const sendBody = $derived(
		`Se ${1 === typed.length ? 'envía' : 'envían'} ${productCount} para aprobación. El inventario no cambia hasta que un Gerente o Administrador lo apruebe.`
	);
	const unchanged = $derived(
		typed.filter((product) =>
			preview?.changes.every((change) => product.product_id !== change.product_id)
		)
	);

	const found = $derived.by(() => {
		const words = fold(query).split(/\s+/).filter(Boolean);
		const shown = new Set(onScreen.map((product) => product.product_id));
		return data.products.filter(
			(product) =>
				!shown.has(product.product_id) && words.every((word) => fold(product.name).includes(word))
		);
	});

	function isTyped(productId: number): boolean {
		return 'number' === typeof counted[productId];
	}

	function add(product: CountableProduct) {
		added.push(product);
		query = '';
	}

	function resultButtons(): Iterable<HTMLElement> {
		return resultList?.querySelectorAll<HTMLElement>('.result') ?? [];
	}

	// Enter adds the first result, or the focused one, and moves on to its count. The arrows go
	// from the search into its results and through them.
	function keyInSearch(event: KeyboardEvent) {
		if ('Enter' !== event.key) {
			moveThroughResults(event, event.currentTarget as HTMLElement, resultButtons());
			return;
		}
		event.preventDefault();
		if (found.length) {
			addAndFocus(found[0]);
		}
	}

	function keyInResults(event: KeyboardEvent, product: CountableProduct) {
		if ('Enter' === event.key) {
			event.preventDefault();
			addAndFocus(product);
			return;
		}
		moveThroughResults(event, document.getElementById(SEARCH_ID), resultButtons());
	}

	async function addAndFocus(product: CountableProduct) {
		add(product);
		await tick();
		document.getElementById(`counted-${product.product_id}`)?.focus();
	}

	function focusSearch(event: KeyboardEvent) {
		if (event.ctrlKey && 'k' === event.key.toLowerCase()) {
			event.preventDefault();
			document.getElementById(SEARCH_ID)?.focus();
		}
	}

	function remove(index: number) {
		delete counted[added[index].product_id];
		added.splice(index, 1);
	}

	function systemHint(product: CountableProduct): string {
		const system = formatInteger(product.total_quantity);
		return `Sistema: ${system} · En alquiler: ${formatInteger(data.onRent[product.product_id] ?? 0)}`;
	}

	function reason({ recoverable, order_ids: orderIds }: SuggestedProduct): string {
		const units = `${formatInteger(recoverable)} ${1 === recoverable ? 'recuperable' : 'recuperables'}`;
		const orders = orderIds.map((id) => `#${id}`).join(', ');
		return `${units} · ${1 === orderIds.length ? 'Pedido' : 'Pedidos'} ${orders}`;
	}

	// Fewer than the system says reads as a shortage: in red.
	function isShort(product: CountableProduct): boolean {
		return (counted[product.product_id] ?? product.total_quantity) < product.total_quantity;
	}

	function difference(product: CountableProduct): string {
		const total = product.total_quantity;
		const change = (counted[product.product_id] ?? total) - total;
		if (0 === change) {
			return 'Igual al sistema';
		}
		return `Diferencia ${0 < change ? '+' : '−'}${formatInteger(Math.abs(change))}`;
	}

	// With nothing typed there's nothing to confirm: the service says what's missing. Otherwise the
	// fields are checked before asking, since the dialog covers them.
	function isReadyToAsk(): boolean {
		if (0 === typed.length) {
			countForm?.requestSubmit();
			return false;
		}
		return countForm?.reportValidity() ?? false;
	}

	function askToSend() {
		isSendOpen = isReadyToAsk();
	}

	// Approving now confirms what it changes and which pending counts share its products, which
	// only the server knows.
	async function askToApprove() {
		if (!isReadyToAsk()) {
			return;
		}
		const response = await fetch(resolve('/inventario/aprobacion'), {
			method: 'POST',
			body: JSON.stringify({ items })
		});
		const answer: ApprovalPreview | { message: string } = await response.json();
		if ('message' in answer) {
			previewMessage = answer.message;
			return;
		}
		previewMessage = '';
		preview = answer;
		isApproveOpen = true;
	}

	// Sent, the screen starts a fresh count over the reloaded suggested list; a refusal keeps what
	// was typed. The dialog closes once the server answers.
	const afterSave: SubmitFunction = () => {
		return async ({ result, update }) => {
			if ('success' === result.type) {
				added = [];
				counted = {};
				note = '';
			}
			await update({ reset: false });
			previewMessage = '';
			isSendOpen = false;
			isApproveOpen = false;
		};
	};

	// Enter in a count would submit it without its confirmation, and a sent count can't be withdrawn.
	function keepEnterFromSending(event: KeyboardEvent) {
		if ('Enter' === event.key) {
			event.preventDefault();
		}
	}

	const errorMessage = $derived(previewMessage || form?.errors?.items || form?.message);
</script>

<svelte:window onkeydown={focusSearch} />

<svelte:head>
	<title>Conteo físico · Banquetes Consuelo C</title>
</svelte:head>

{#snippet row(product: CountableProduct, detail: string | null, index: number | null)}
	{@const fieldId = `counted-${product.product_id}`}
	<li class="row">
		<div class="row__product">
			<b class="row__name">{product.name}</b>
			{#if detail}
				<p class="meta row__reason">{detail}</p>
			{/if}
			<p class="meta">{systemHint(product)}</p>
		</div>
		<div class={['row__field', isShort(product) && 'row__field--short']}>
			<Field
				label="Contado"
				id={fieldId}
				hint={isTyped(product.product_id) ? difference(product) : undefined}
			>
				<Input
					id={fieldId}
					type="number"
					inputmode="numeric"
					min="0"
					step="1"
					autocomplete="off"
					onkeydown={keepEnterFromSending}
					bind:value={counted[product.product_id]}
				/>
			</Field>
		</div>
		{#if null !== index}
			<div class="row__remove">
				<IconButton
					icon="trash"
					size="lg"
					label="Quitar {product.name}"
					onclick={() => remove(index)}
				/>
			</div>
		{/if}
	</li>
{/snippet}

<Screen>
	{#snippet header()}
		{#if data.canReview}
			<ScreenHeader><Tabs tabs={INVENTORY_TABS} current="Conteo físico" /></ScreenHeader>
		{:else}
			<ScreenHeader title="Conteo físico" />
		{/if}
	{/snippet}

	<UnsavedChangesGuard form="count" />

	{#if form?.sentId}
		<div class="lead">
			<Notice tone="success">
				<b>Conteo #{form.sentId} {form.approved ? 'aprobado' : 'enviado para aprobación'}</b><br />
				{form.approved
					? 'El inventario quedó actualizado.'
					: 'El inventario cambia cuando un Gerente o Administrador lo apruebe.'}
				Puedes empezar otro conteo.
			</Notice>
		</div>
	{/if}
	<Notice tone="info">
		Escribe el total de la empresa: lo que hay en bodega más lo que está en alquiler.
	</Notice>

	<form id="count" method="POST" action="?/enviar" bind:this={countForm} use:enhance={afterSave}>
		<input type="hidden" name="items" value={JSON.stringify(items)} />

		<h2 class="section-title group">Sugeridos</h2>
		{#if 0 === data.suggested.length}
			<p class="meta empty">No hay novedades recuperables por verificar.</p>
		{:else}
			<ul class="rows">
				{#each data.suggested as product (product.product_id)}
					{@render row(product, reason(product), null)}
				{/each}
			</ul>
		{/if}

		<h2 class="section-title group">Otros productos</h2>
		{#if added.length}
			<ul class="rows">
				{#each added as product, index (product.product_id)}
					{@render row(product, null, index)}
				{/each}
			</ul>
		{/if}
	</form>

	<label class="search">
		<Icon name="search" size="sm" />
		<Input
			id={SEARCH_ID}
			type="search"
			autocomplete="off"
			placeholder="Buscar otro producto"
			aria-label="Buscar otro producto"
			aria-keyshortcuts="Control+K"
			bind:value={query}
			onkeydown={keyInSearch}
		/>
	</label>
	{#if '' !== query.trim()}
		<div class="results">
			<p class="meta results__count">
				{found.length}
				{1 === found.length ? 'resultado' : 'resultados'}
			</p>
			<div class="results__list" bind:this={resultList}>
				{#each found as product (product.product_id)}
					<button
						class="result"
						type="button"
						onclick={() => add(product)}
						onkeydown={(event) => keyInResults(event, product)}
					>
						<span class="result__text">
							<span>{product.name}</span>
							<span class="meta">{systemHint(product)}</span>
						</span>
						<Icon name="plus" size="sm" />
					</button>
				{:else}
					<p class="meta results__none">Ningún producto activo coincide.</p>
				{/each}
			</div>
		</div>
	{/if}

	<p class="note send-note">
		{0 === typed.length
			? 'Escribe lo contado en al menos un producto.'
			: `Se ${1 === typed.length ? 'envía' : 'envían'} ${productCount}.`}
		Los que dejes en blanco no se cuentan.
	</p>
	{#if errorMessage}
		<div class="error"><Notice tone="error">{errorMessage}</Notice></div>
	{/if}

	<div class="screen__action actions">
		<Button type="button" onclick={askToSend}>Enviar para aprobación</Button>
		{#if data.canReview}
			<Button type="button" variant="secondary" onclick={askToApprove}>Guardar y aprobar</Button>
		{/if}
	</div>
</Screen>

<Modal bind:open={isSendOpen} title="Enviar conteo" body={sendBody}>
	<p>Después de enviarlo no se puede editar ni retirar.</p>
	{#snippet actions()}
		<Button type="button" variant="secondary" onclick={() => (isSendOpen = false)}>Volver</Button>
		<Button type="submit" form="count" size="md">Enviar conteo</Button>
	{/snippet}
</Modal>

{#if data.canReview && preview}
	<Modal
		bind:open={isApproveOpen}
		title="Guardar y aprobar conteo"
		body={preview.changes.length
			? 'Cambia el inventario:'
			: 'El inventario no cambia: lo contado coincide con el sistema.'}
	>
		<div class="form-stack">
			{#if preview.changes.length}
				<ul class="changes">
					{#each preview.changes as change (change.product_id)}
						<li>{change.name}: {formatInteger(change.from)} → {formatInteger(change.to)}</li>
					{/each}
				</ul>
				{#if unchanged.length}
					<p>Sin cambio: {unchanged.map(({ name }) => name).join(', ')}.</p>
				{/if}
			{/if}
			{#if preview.overlaps.length}
				<OverlapNotice overlaps={preview.overlaps} />
			{/if}
			<Field label="Nota (opcional)" id="approve-note">
				<textarea
					class="textarea"
					id="approve-note"
					name="note"
					form="count"
					rows="2"
					bind:value={note}></textarea>
			</Field>
			<p class="note">
				Un Gerente o Administrador puede revertirlo mientras sea el último movimiento de estos
				productos.
			</p>
		</div>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isApproveOpen = false)}>
				Volver
			</Button>
			<Button type="submit" form="count" formaction="?/aprobar" size="md">Aprobar conteo</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	p {
		margin: 0;
	}

	.lead {
		margin-bottom: var(--space-6);
	}

	.group {
		margin-top: var(--space-9);
	}

	.empty {
		padding: var(--space-5) 0;
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.rows {
		padding: 0;
		margin: 0 0 var(--space-6);
		list-style: none;
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	/* The product beside its count; an added one also gets its 48px «Quitar». */
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 104px;
		gap: var(--space-5);
		align-items: start;
		padding: var(--space-5) 0;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.row:has(.row__remove) {
		grid-template-columns: minmax(0, 1fr) 104px var(--tap-min);
	}

	.row__product {
		min-width: 0;
		padding-top: var(--space-2);
	}

	.row__name {
		font-size: var(--text-base);
		line-height: 1.3;
	}

	.row__reason {
		margin-top: var(--space-1);
		color: var(--text-body);
	}

	.row__field :global(.input) {
		min-height: var(--tap-min);
		font-weight: var(--weight-semibold);
		text-align: right;
	}

	.row__field :global(.field__hint) {
		text-align: right;
	}

	.row__field--short :global(.field__hint) {
		font-weight: var(--weight-semibold);
		color: var(--error-fg);
	}

	.row__remove {
		padding-top: var(--space-9);
	}

	.search {
		position: relative;
		display: block;
		max-width: 480px;
	}

	.search :global(.icon) {
		position: absolute;
		top: 50%;
		left: var(--input-icon-inset);
		color: var(--text-disabled);
		pointer-events: none;
		translate: 0 -50%;
	}

	.search :global(.input) {
		min-height: var(--tap-min);
		padding-left: var(--input-icon-pad);
	}

	.results {
		max-width: 480px;
		margin-top: var(--space-4);
		overflow: hidden;
		border: var(--border-w-strong) solid var(--border-strong);
		border-radius: var(--radius-card);
	}

	.results__count,
	.results__none {
		padding: var(--space-4) var(--space-7);
	}

	.results__count {
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.results__list {
		max-height: 288px;
		overflow: auto;
	}

	.result {
		box-sizing: border-box;
		display: flex;
		gap: var(--space-6);
		align-items: center;
		width: 100%;
		min-height: var(--tap-min);
		padding: var(--space-4) var(--space-7);
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

	.send-note {
		margin-top: var(--space-8);
	}

	.error {
		margin-top: var(--space-5);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: var(--control-gap);
	}

	.changes {
		padding-left: var(--space-8);
		margin: 0;
		font-weight: var(--weight-semibold);
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

	@container (width >= 1024px) {
		.actions {
			flex-direction: row;
		}

		.actions > :global(.btn) {
			width: auto;
		}
	}
</style>
