<script lang="ts" module>
	import { formatPesos } from '$lib/format';
	import type { OrderItem } from '$lib/server/services/orders';

	/** A line as the form holds it: quantity and price stay text, as typed, until saved. */
	export type FormLine = {
		productId: number;
		name: string;
		listPrice: number;
		qty: string;
		unitPrice: string;
	};

	/** A saved line as the form holds it: its frozen name and prices, its quantity. */
	export function toFormLine(item: OrderItem): FormLine {
		return {
			productId: item.product_id,
			name: item.name,
			listPrice: item.list_price,
			qty: String(item.qty),
			unitPrice: formatPesos(item.unit_price)
		};
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import { fold } from '$lib/format';
	import { calculateOrderTotals } from '$lib/orders';
	import { parsePesos, parseQuantity } from '$lib/payroll';
	import type { CatalogProduct, OrderDetail } from '$lib/server/services/orders';
	import { moveThroughResults } from './order-form';

	// The grid: an expandable compact row per line on a phone, one open at a time; an invoice table
	// on a desktop. Products are added from a search over the active catalog, accents and case
	// folded; each variant is its own product. Availability only warns. On a phone the search climbs
	// to the top of the screen as it's typed in, its results below it; on a desktop it's a dialog,
	// also opened with Ctrl+K from any field. The arrows move through the results, and Enter, a click
	// or a tap adds the first or the chosen one and moves on to its quantity.
	interface Props {
		lines: FormLine[];
		products: CatalogProduct[];
		/**
		 * Each product's availability for the order's range; null until both dates are typed. Left out
		 * on a quote, which reserves nothing: no line shows any.
		 */
		availability?: Map<number, number> | null;
		/** The range it was counted for, as `14 ago – 16 ago`. */
		rangeLabel?: string;
		/** The lines' field in the posted record, which its errors are named after. */
		field?: 'order_items' | 'quote_items';
		rentalDays: number;
		errorOf: (path: string) => string | undefined;
		/** An extension's original: its lines are picked from there, no search, each up to its quantity. */
		original?: Pick<OrderDetail, 'id' | 'items'> | null;
	}

	let {
		lines = $bindable(),
		products,
		availability,
		rangeLabel = '',
		rentalDays,
		errorOf,
		original = null,
		field = 'order_items'
	}: Props = $props();

	const showsAvailability = $derived(undefined !== availability);

	const SEARCH_ID = 'product-search';
	const DIALOG_SEARCH_ID = 'product-search-dialog';

	let query = $state('');
	// The phone's row a product was just added to, or picked again from the search, opens.
	let openId = $state<number | null>(null);

	const pricing = $derived(
		calculateOrderTotals({
			lines: lines.map((line) => ({
				qty: parseQuantity(line.qty) || 0,
				unit_price: parsePesos(line.unitPrice)
			})),
			rentalDays,
			discount: 0,
			transportCost: 0
		})
	);
	const lineTotals = $derived(pricing.lineTotals);

	const isSearching = $derived('' !== query.trim());
	const found = $derived.by(() => {
		const words = fold(query).split(/\s+/).filter(Boolean);
		return products.filter((product) => {
			const text = fold([product.name, product.variantGroup, product.variantName].join(' '));
			return words.every((word) => text.includes(word));
		});
	});
	const countLabel = $derived(`${lines.length} ${1 === lines.length ? 'línea' : 'líneas'}`);
	// Each line's total is per day: the label says for how many, so the column adds up.
	const totalLabel = $derived(
		0 === rentalDays ? 'Total' : `Total (${rentalDays} ${1 === rentalDays ? 'día' : 'días'})`
	);

	function totalQuantityOf(productId: number): number | undefined {
		return products.find((product) => productId === product.id)?.totalQuantity;
	}

	function availableOf(productId: number): number | undefined {
		return availability?.get(productId);
	}

	function availabilityText(productId: number): string {
		const available = availableOf(productId);
		if (undefined === available) {
			return 'Escribe las fechas para ver la disponibilidad';
		}
		const total = totalQuantityOf(productId);
		return `Disponible ${rangeLabel}: ${available}${undefined === total ? '' : ` de ${total}`}`;
	}

	// Overbooked warns and never blocks: the line still saves.
	function isOver(line: FormLine): boolean {
		const available = availableOf(line.productId);
		return undefined !== available && parseQuantity(line.qty) > available;
	}

	// Adding a product again goes to its line, which opens.
	function add(product: CatalogProduct) {
		if (!lines.some((line) => product.id === line.productId)) {
			const unitPrice = formatPesos(product.rentalPrice);
			lines.push({
				productId: product.id,
				name: product.name,
				listPrice: product.rentalPrice,
				qty: '1',
				unitPrice
			});
		}
		openId = product.id;
		query = '';
	}

	function remove(productId: number) {
		lines = lines.filter((line) => productId !== line.productId);
	}

	function isPicked(item: OrderItem): boolean {
		return lines.some((line) => item.product_id === line.productId);
	}

	// Picked again, a line comes back as the original has it.
	function toggle(item: OrderItem) {
		if (isPicked(item)) {
			remove(item.product_id);
		} else {
			lines.push(toFormLine(item));
		}
	}

	function maxNote(productId: number): string {
		const item = original?.items.find((each) => productId === each.product_id);
		return item
			? `Máximo ${item.qty}, lo que tiene el pedido #${original?.id}. Con su precio.`
			: '';
	}

	let dialog: HTMLDialogElement | undefined = $state();

	// The results of whichever search is in use: the phone's field or the desktop's dialog.
	function resultButtons(searchId: string): Iterable<HTMLElement> {
		const list = document.getElementById(searchId)?.closest('.search-area');
		return list?.querySelectorAll<HTMLElement>('.result') ?? [];
	}

	// Enter would submit the order: it adds the first result instead. Down goes to the results.
	function keyInSearch(event: KeyboardEvent) {
		const search = event.currentTarget as HTMLElement;
		if ('Enter' !== event.key) {
			moveThroughResults(event, search, resultButtons(search.id));
			return;
		}
		event.preventDefault();
		if (found.length) {
			pick(found[0]);
		}
	}

	function keyInResults(event: KeyboardEvent, product: CatalogProduct) {
		if ('Enter' === event.key) {
			event.preventDefault();
			pick(product);
			return;
		}
		const searchId = dialog?.open ? DIALOG_SEARCH_ID : SEARCH_ID;
		moveThroughResults(event, document.getElementById(searchId), resultButtons(searchId));
	}

	// By mouse, tap or keyboard, the added line's quantity takes the focus, in whichever of the
	// phone's rows or the desktop's table is showing: on a phone, the number keyboard opens.
	async function pick(product: CatalogProduct) {
		dialog?.close();
		add(product);
		await tick();
		const inputs = document.querySelectorAll<HTMLInputElement>(`[data-qty="${product.id}"]`);
		const shown = [...inputs].find((input) => null !== input.offsetParent);
		shown?.focus();
		shown?.select();
	}

	function openDialog() {
		dialog?.showModal();
		document.getElementById(DIALOG_SEARCH_ID)?.focus();
	}

	// The phone's field when it's the one showing, else the desktop's dialog.
	function focusSearch(event: KeyboardEvent) {
		if (!event.ctrlKey || 'k' !== event.key.toLowerCase()) {
			return;
		}
		event.preventDefault();
		const field = document.getElementById(SEARCH_ID);
		if (null !== field?.offsetParent) {
			field?.focus();
		} else {
			openDialog();
		}
	}

	// The phone's results, once there's something typed: the search climbs to the top of the
	// screen, and the list takes the height left below it, above the keyboard when it's open.
	function climb(list: HTMLElement) {
		const area = list.closest<HTMLElement>('.search-area');
		area?.scrollIntoView({ block: 'start' });
		const fit = () => {
			const viewport = window.visualViewport;
			const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
			list.style.maxHeight = `${Math.max(160, bottom - list.getBoundingClientRect().top - 8)}px`;
		};
		fit();
		window.visualViewport?.addEventListener('resize', fit);
		return () => window.visualViewport?.removeEventListener('resize', fit);
	}
</script>

<svelte:window onkeydown={focusSearch} />

{#snippet overNotice(line: FormLine)}
	<Notice tone="warning">
		⚠ Disponible: {availableOf(line.productId)} — supera el inventario. Puedes continuar igual.
	</Notice>
{/snippet}

<div class="lines__head">
	<h2 class="section-title">Productos</h2>
	<span class="meta">{countLabel}</span>
</div>

{#if errorOf(field)}
	<p class="field-error">{errorOf(field)}</p>
{/if}

{#if original}
	<fieldset class="picks">
		<legend class="picks__legend">Líneas del pedido #{original.id}</legend>
		{#each original.items as item (item.product_id)}
			<label class="pick">
				<input type="checkbox" checked={isPicked(item)} onchange={() => toggle(item)} />
				<span class="pick__name">{item.name}</span>
				<span class="meta">hasta {item.qty}</span>
			</label>
		{/each}
	</fieldset>
{/if}

<div class="phone-only">
	{#each lines as line, index (line.productId)}
		<details class="order-line" name="lineas" open={line.productId === openId}>
			<summary>
				<span>{line.qty} × {line.name}</span>
				<span class="order-line__total">
					{#if isOver(line)}<span class="over">⚠</span>{/if}
					{formatPesos(lineTotals[index])}
				</span>
			</summary>
			<div class="order-line__body">
				{#if isOver(line)}
					<div class="order-line__notice">{@render overNotice(line)}</div>
				{/if}
				<div class="field-row">
					<div class="field">
						<label class="field__label" for="line-{line.productId}-qty">Cantidad</label>
						<Input
							id="line-{line.productId}-qty"
							data-qty={line.productId}
							inputmode="numeric"
							aria-invalid={undefined !== errorOf(`${field}.${index}.qty`)}
							bind:value={line.qty}
						/>
					</div>
					<div class="field">
						<label class="field__label" for="line-{line.productId}-price">Precio a cobrar</label>
						<Input
							id="line-{line.productId}-price"
							inputmode="numeric"
							aria-invalid={undefined !== errorOf(`${field}.${index}.unit_price`)}
							bind:value={line.unitPrice}
						/>
					</div>
				</div>
				{#each ['qty', 'unit_price', 'product_id'] as key (key)}
					{#if errorOf(`${field}.${index}.${key}`)}
						<p class="field-error">{errorOf(`${field}.${index}.${key}`)}</p>
					{/if}
				{/each}
				{#if original}
					<p class="field__hint">{maxNote(line.productId)}</p>
				{/if}
				<div class="order-line__foot">
					<span class="meta">
						Lista {formatPesos(line.listPrice)} · {totalLabel}
						{formatPesos(lineTotals[index])}
					</span>
					<IconButton
						icon="trash"
						label="Quitar {line.name}"
						onclick={() => remove(line.productId)}
					/>
				</div>
				{#if showsAvailability}
					<p class="meta">{availabilityText(line.productId)}</p>
				{/if}
			</div>
		</details>
	{/each}
</div>

{#if lines.length}
	<table class="table desktop-only">
		<thead>
			<tr>
				<th>Producto</th>
				<th class="num col-qty">Cant.</th>
				<th class="num">Lista</th>
				<th class="num col-price">A cobrar</th>
				<th class="num">{totalLabel}</th>
				<th class="col-remove"><span class="visually-hidden">Quitar</span></th>
			</tr>
		</thead>
		<tbody>
			{#each lines as line, index (line.productId)}
				<tr class={{ 'row--noted': isOver(line) || errorOf(`${field}.${index}.qty`) }}>
					<td>
						{line.name}
						{#if showsAvailability}
							<span class="meta">{availabilityText(line.productId)}</span>
						{/if}
						{#if original}<span class="meta">{maxNote(line.productId)}</span>{/if}
					</td>
					<td class="num">
						<Input
							data-qty={line.productId}
							inputmode="numeric"
							aria-label="Cantidad de {line.name}"
							aria-invalid={undefined !== errorOf(`${field}.${index}.qty`)}
							bind:value={line.qty}
						/>
					</td>
					<td class="num">{formatPesos(line.listPrice)}</td>
					<td class="num">
						<Input
							inputmode="numeric"
							aria-label="Precio a cobrar de {line.name}"
							aria-invalid={undefined !== errorOf(`${field}.${index}.unit_price`)}
							bind:value={line.unitPrice}
						/>
					</td>
					<td class="num"><b>{formatPesos(lineTotals[index])}</b></td>
					<td class="num">
						<IconButton
							icon="trash"
							label="Quitar {line.name}"
							onclick={() => remove(line.productId)}
						/>
					</td>
				</tr>
				{#if isOver(line) || errorOf(`${field}.${index}.qty`) || errorOf(`${field}.${index}.unit_price`)}
					<tr>
						<td colspan="6" class="row__note">
							{#if isOver(line)}{@render overNotice(line)}{/if}
							{#each ['qty', 'unit_price', 'product_id'] as key (key)}
								{#if errorOf(`${field}.${index}.${key}`)}
									<p class="field-error">{errorOf(`${field}.${index}.${key}`)}</p>
								{/if}
							{/each}
						</td>
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
{/if}

<div class="subtotal">
	<span>Subtotal</span><span>{formatPesos(pricing.itemsTotal)}</span>
</div>

{#snippet results()}
	{#each found as product (product.id)}
		<button
			class="result"
			type="button"
			onclick={() => pick(product)}
			onkeydown={(event) => keyInResults(event, product)}
		>
			<span class="result__text">
				<span>{product.name}</span>
				{#if showsAvailability}
					<span class="meta">{availabilityText(product.id)}</span>
				{/if}
			</span>
			<span class="result__price">{formatPesos(product.rentalPrice)}</span>
			<Icon name="plus" size="sm" />
		</button>
	{/each}
{/snippet}

{#snippet count()}
	<p class="meta results__count">
		{found.length}
		{1 === found.length ? 'resultado' : 'resultados'}
	</p>
{/snippet}

{#if !original}
	<!-- A phone: the field stays below the subtotal, and climbs once something is typed. -->
	<div class="search-area phone-only">
		<label class="search">
			<Icon name="search" size="sm" />
			<Input
				id={SEARCH_ID}
				type="search"
				placeholder="Buscar producto para agregar…"
				aria-label="Buscar producto"
				bind:value={query}
				onkeydown={keyInSearch}
			/>
		</label>
		{#if isSearching}
			<div class="results">
				{@render count()}
				<div class="results__list" {@attach climb}>{@render results()}</div>
			</div>
		{/if}
	</div>

	<!-- A desktop: a field-shaped button that opens the search in a dialog. -->
	<div class="desktop-only">
		<button
			class="search search--trigger"
			type="button"
			aria-keyshortcuts="Control+K"
			aria-describedby="product-search-hint"
			onclick={openDialog}
		>
			<Icon name="search" size="sm" />
			<span>Buscar producto para agregar…</span>
		</button>
		<p class="meta search__hint" id="product-search-hint">
			Ctrl+K abre esta búsqueda desde cualquier campo.
		</p>
	</div>

	<!-- Esc, the close button or a click on the scrim close it and clear the search. -->
	<dialog
		class="picker search-area"
		aria-label="Buscar producto"
		bind:this={dialog}
		onclose={() => (query = '')}
		onclick={(event) => event.target === event.currentTarget && dialog?.close()}
	>
		<div class="picker__head">
			<label class="search picker__search">
				<Icon name="search" size="sm" />
				<Input
					id={DIALOG_SEARCH_ID}
					type="search"
					placeholder="Buscar producto…"
					aria-label="Buscar producto"
					bind:value={query}
					onkeydown={keyInSearch}
				/>
			</label>
			<IconButton icon="close" label="Cerrar" onclick={() => dialog?.close()} />
		</div>
		{#if isSearching}
			{@render count()}
			<div class="picker__list">{@render results()}</div>
		{:else}
			<p class="meta results__count">{products.length} productos en el catálogo</p>
		{/if}
	</dialog>
{/if}

<style>
	p {
		margin: 0;
	}

	.lines__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: var(--space-5);
	}

	.lines__head .section-title {
		margin: 0;
	}

	/* The Design System's summary row, as in the form's Totales. */
	.subtotal {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		justify-content: space-between;
		font-size: var(--text-base);
		line-height: var(--leading-loose);
		color: var(--text-secondary);
	}

	.subtotal > :last-child {
		font-weight: var(--weight-semibold);
		color: var(--text-body);
	}

	.search {
		position: relative;
		display: block;
		margin-bottom: var(--space-3);
	}

	.search__hint {
		margin-bottom: var(--space-5);
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
		padding-left: var(--input-icon-pad);
	}

	.results {
		margin: 0 0 var(--space-7);
		overflow: hidden;
		border: var(--border-w-strong) solid var(--border-strong);
		border-radius: var(--radius-card);
	}

	.results__count {
		padding: var(--space-4) var(--space-7);
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.results__list {
		overflow: auto;
		overscroll-behavior: contain;
	}

	.search--trigger {
		box-sizing: border-box;
		display: flex;
		gap: var(--space-5);
		align-items: center;
		width: 100%;
		min-height: 48px;
		padding: 0 var(--space-7);
		font: var(--type-input);
		color: var(--text-disabled);
		text-align: left;
		cursor: text;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-input);
	}

	.search--trigger :global(.icon) {
		position: static;
		translate: none;
	}

	/* The desktop's dialog: centred, at most 640 by 640, the results scrolling inside it. */
	.picker {
		box-sizing: border-box;
		display: none;
		flex-direction: column;
		width: min(640px, calc(100% - 64px));
		height: min(640px, 80dvh);
		padding: 0;
		margin: auto;
		overflow: hidden;
		color: var(--text-body);
		background: var(--surface-card);
		border: var(--border-w-strong) solid var(--border-strong);
		border-radius: var(--radius-dialog);
		box-shadow: var(--shadow-dialog);
	}

	.picker[open] {
		display: flex;
	}

	.picker::backdrop {
		background: var(--scrim);
	}

	.picker__head {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		padding: var(--space-7);
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.picker__search {
		flex: 1;
		margin: 0;
	}

	.picker__list {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}

	.result {
		box-sizing: border-box;
		display: flex;
		gap: var(--space-6);
		align-items: center;
		width: 100%;
		min-height: 56px;
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

	.result__price {
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
	}

	/* The original's lines: a checkbox row each, under an ink rule. */
	.picks {
		min-width: 0;
		padding: 0;
		margin: 0 0 var(--space-7);
		border: 0;
	}

	.picks__legend {
		padding: 0;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	.pick {
		display: flex;
		gap: var(--space-6);
		align-items: center;
		min-height: 48px;
		cursor: pointer;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.pick:first-of-type {
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.pick input {
		flex: none;
		width: 20px;
		height: 20px;
		margin: 0;
		accent-color: var(--neutral-800);
	}

	.pick__name {
		flex: 1;
		font-size: var(--text-base);
	}

	.field__hint {
		margin: 0 0 var(--space-4);
		font-size: var(--text-label);
		font-style: italic;
		color: var(--text-secondary);
	}

	.field-error {
		margin: var(--space-3) 0;
		font-size: var(--text-xs);
		color: var(--error-fg);
	}

	/* The phone's compact row: the Design System's .order-line. */
	.order-line {
		margin: 0 0 var(--space-5);
		overflow: hidden;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-card);
	}

	.order-line[open] {
		border-color: var(--border-strong);
	}

	.order-line > summary {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		justify-content: space-between;
		padding: var(--space-7) var(--space-8);
		font-size: var(--text-base);
		cursor: pointer;
		list-style: none;
	}

	.order-line > summary::-webkit-details-marker {
		display: none;
	}

	.order-line__total {
		display: flex;
		flex: none;
		gap: var(--space-5);
		align-items: center;
		font-weight: var(--weight-semibold);
	}

	.order-line__total::after {
		width: 12px;
		font-size: var(--text-3xl);
		font-weight: var(--weight-regular);
		color: var(--text-secondary);
		text-align: center;
		content: '›';
	}

	.order-line[open] .order-line__total::after {
		content: '⌄';
	}

	.order-line__body {
		padding: var(--space-7) var(--space-8) var(--space-8);
		border-top: var(--border-w-hair) solid var(--border-default);
	}

	.order-line__notice {
		margin-bottom: var(--space-5);
	}

	.order-line__foot {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		justify-content: space-between;
		margin-top: var(--space-4);
	}

	.over {
		color: var(--warning-fg);
	}

	.field-row {
		display: flex;
		gap: var(--control-gap);
	}

	.field {
		flex: 1;
		min-width: 0;
	}

	.field__label {
		display: block;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	/* The Design System's compact input, in the rows and the table. */
	.order-line__body :global(.input),
	.table :global(.input) {
		padding: var(--space-5) var(--space-6);
	}

	.desktop-only {
		display: none;
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
		vertical-align: middle;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.table .meta {
		display: block;
	}

	.table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.table .num :global(.input) {
		text-align: right;
	}

	.row--noted td {
		border-bottom: 0;
	}

	.row__note {
		padding-top: 0;
	}

	.col-qty {
		width: 80px;
	}

	.col-price {
		width: 110px;
	}

	.col-remove {
		width: 44px;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		white-space: nowrap;
		clip-path: inset(50%);
	}

	@container (width >= 1024px) {
		.phone-only {
			display: none;
		}

		.table.desktop-only {
			display: table;
		}

		div.desktop-only {
			display: block;
		}
	}
</style>
