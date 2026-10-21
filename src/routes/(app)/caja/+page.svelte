<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Input from '$lib/components/Input.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Select from '$lib/components/Select.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import {
		formatInstant,
		formatInstantTime,
		formatLongDay,
		formatPeriod,
		formatShortDay
	} from '$lib/datetime';
	import { formatPesos, formatReceiptNumber, formatSignedPesos } from '$lib/format';
	import { CASH_CONCEPT_LABELS, PAYMENT_METHOD_LABELS } from '$lib/labels';
	import { CASH_TABS } from '$lib/navigation';
	import type { CashBookEntry, MovementDetail, ReceiptReference } from '$lib/server/services/cash';
	import type { PageProps } from './$types';

	// An auditable record, not a day's close: no opening balance, and the net mixes cash with
	// transfers. Rows on a phone, a wider table from 1024px; the filters in a sheet on a phone and
	// under a toggle on a desktop, both a GET form, so a filtered book is a URL. A movement's detail
	// is the same URL plus `?movimiento=`: its own view on a phone, a side panel on a desktop.
	let { data }: PageProps = $props();

	const movement = $derived(data.movement);

	const filters = $derived(data.book.filters);
	const entries = $derived(data.book.entries);
	const totals = $derived(data.book.totals);

	const period = $derived(formatPeriod(filters.from, filters.to));
	// The filters beyond the period, counted the way the screen reads them: «2 filtros más».
	const extraCount = $derived(
		[
			filters.direction,
			filters.concept,
			filters.method,
			filters.employee,
			filters.min,
			filters.max,
			filters.text
		].filter((value) => undefined !== value).length
	);
	const extras = $derived(
		0 === extraCount ? '' : ` · ${extraCount} ${1 === extraCount ? 'filtro más' : 'filtros más'}`
	);
	const net = $derived(`${totals.net < 0 ? '−' : ''}${formatPesos(Math.abs(totals.net))}`);

	let isSheetOpen = $state(false);
	let areFiltersShown = $state(false);

	type Choice = {
		name: string;
		label: string;
		current: string;
		options: [value: string, label: string][];
	};

	// '' is «no filter»: the chips call it «Todos».
	const DIRECTION_OPTIONS: Choice['options'] = [
		['', 'Entradas y salidas'],
		['IN', 'Entradas'],
		['OUT', 'Salidas']
	];
	const METHOD_OPTIONS: Choice['options'] = [
		['', 'Todos'],
		...Object.entries(PAYMENT_METHOD_LABELS)
	];

	const directionChoice = $derived<Choice>({
		name: 'tipo',
		label: 'Tipo',
		options: DIRECTION_OPTIONS,
		current: filters.direction ?? ''
	});
	const methodChoice = $derived<Choice>({
		name: 'metodo',
		label: 'Método',
		options: METHOD_OPTIONS,
		current: filters.method ?? ''
	});

	// The link: the payroll week it pays, or the third party of a standalone movement.
	function link(entry: CashBookEntry): string {
		return null === entry.weekNumber ? (entry.payee ?? '') : `Semana ${entry.weekNumber}`;
	}

	// Who the money went to or came from: the employee paid, or the payee.
	function party(entry: Pick<CashBookEntry, 'employeeName' | 'payee'>): string {
		return entry.employeeName ?? entry.payee ?? '';
	}

	function joined(...parts: (string | null)[]): string {
		return parts.filter(Boolean).join(' · ');
	}

	// A phone's second line: what it was and for whom.
	function summary(entry: CashBookEntry): string {
		if (null === entry.weekNumber) {
			return joined(entry.description, entry.payee);
		}
		return joined(link(entry), party(entry));
	}

	// The book as filtered, with or without a movement's detail open over it.
	function bookHref(movementId?: number): string {
		const kept = [...page.url.searchParams].filter(([name]) => 'movimiento' !== name);
		const opened = undefined === movementId ? [] : [['movimiento', String(movementId)]];
		const query = new URLSearchParams([...kept, ...opened]).toString();
		return `${resolve('/(app)/caja')}${query ? `?${query}` : ''}`;
	}

	function receiptTitle({ amount }: ReceiptReference): string {
		return 0 < amount ? 'Recibo de caja' : 'Comprobante de egreso';
	}

	function receiptName(receipt: ReceiptReference): string {
		return `${receiptTitle(receipt)} N.º ${formatReceiptNumber(receipt.receiptNumber)}`;
	}

	// A PAYROLL movement says which week it paid.
	function detailTitle(detail: MovementDetail): string {
		const concept = CASH_CONCEPT_LABELS[detail.concept];
		return null === detail.weekNumber ? concept : `${concept} · semana ${detail.weekNumber}`;
	}

	// An offsetting movement is never offset, and a movement is offset at most once.
	function isReversible(detail: MovementDetail): boolean {
		return null === detail.reverses && null === detail.reversedBy;
	}

	function submitOnChange(event: Event & { currentTarget: HTMLFormElement }) {
		event.currentTarget.requestSubmit();
	}
</script>

<svelte:head>
	<title>Libro de caja · Banquetes Consuelo C</title>
</svelte:head>

<!-- Tipo and Método: chips in the phone's sheet, a select on a desktop. -->
{#snippet chips(choice: Choice)}
	<fieldset class="choice">
		<legend class="choice__legend">{choice.label}</legend>
		<div class="chip-row">
			{#each choice.options as [value, label] (value)}
				<Chip
					type="radio"
					name={choice.name}
					{value}
					label={'' === value ? 'Todos' : label}
					checked={value === choice.current}
				/>
			{/each}
		</div>
	</fieldset>
{/snippet}

{#snippet select(choice: Choice, prefix: string)}
	<Field label={choice.label} id="{prefix}{choice.name}">
		<Select id="{prefix}{choice.name}" name={choice.name} value={choice.current}>
			{#each choice.options as [value, label] (value)}
				<option {value}>{label}</option>
			{/each}
		</Select>
	</Field>
{/snippet}

{#snippet fields(prefix: string, choice: Snippet<[Choice, string]>)}
	<div class="filters">
		<div class="field-row">
			<Field label="Desde" id="{prefix}desde">
				<Input id="{prefix}desde" name="desde" type="date" value={filters.from} />
			</Field>
			<Field label="Hasta" id="{prefix}hasta">
				<Input id="{prefix}hasta" name="hasta" type="date" value={filters.to} />
			</Field>
		</div>
		{@render choice(directionChoice, prefix)}
		<Field label="Concepto" id="{prefix}concepto">
			<Select id="{prefix}concepto" name="concepto" value={filters.concept ?? ''}>
				<option value="">Todos</option>
				{#each Object.entries(CASH_CONCEPT_LABELS) as [concept, label] (concept)}
					<option value={concept}>{label}</option>
				{/each}
			</Select>
		</Field>
		{@render choice(methodChoice, prefix)}
		<Field label="Empleado" id="{prefix}empleado">
			<Input
				id="{prefix}empleado"
				name="empleado"
				type="search"
				placeholder="Nombre del empleado"
				value={filters.employee ?? ''}
			/>
		</Field>
		<div class="field-row">
			<Field label="Valor desde" id="{prefix}minimo">
				<Input
					id="{prefix}minimo"
					name="minimo"
					inputmode="numeric"
					placeholder="$0"
					value={undefined === filters.min ? '' : formatPesos(filters.min)}
				/>
			</Field>
			<Field label="Valor hasta" id="{prefix}maximo">
				<Input
					id="{prefix}maximo"
					name="maximo"
					inputmode="numeric"
					placeholder="Sin límite"
					value={undefined === filters.max ? '' : formatPesos(filters.max)}
				/>
			</Field>
		</div>
		<div class="filters__search">
			<Field label="Buscar" id="{prefix}texto">
				<span class="search">
					<Icon name="search" size="sm" />
					<Input
						id="{prefix}texto"
						name="texto"
						type="search"
						placeholder="Nombre, descripción o notas"
						value={filters.text ?? ''}
					/>
				</span>
			</Field>
		</div>
	</div>
{/snippet}

{#snippet clearFilters()}
	<Button variant="secondary" size="sm" inline href={resolve('/(app)/caja')}>Limpiar filtros</Button
	>
{/snippet}

{#snippet movementDetail(detail: MovementDetail)}
	<ul class="detail-list">
		<li><span>Tipo</span><span>{0 < detail.amount ? 'Entrada' : 'Salida'}</span></li>
		{#if detail.description}
			<li><span>Descripción</span><span>{detail.description}</span></li>
		{/if}
		<li>
			<span>{0 < detail.amount ? 'Recibido de' : 'Pagado a'}</span><span>{party(detail)}</span>
		</li>
		{#if null !== detail.weekNumber}
			<li><span>Nómina</span><span>Semana {detail.weekNumber}</span></li>
		{/if}
		<li>
			<span>Método</span><span>{detail.otherMethod ?? PAYMENT_METHOD_LABELS[detail.method]}</span>
		</li>
		{#if detail.bankAccount}
			<li><span>Cuenta de destino</span><span>{detail.bankAccount}</span></li>
		{/if}
		{#if detail.notes}
			<li><span>Notas</span><span>{detail.notes}</span></li>
		{/if}
		<li><span>Fecha</span><span>{formatLongDay(detail.movementDate)}</span></li>
		<li><span>Registrado por</span><span>{detail.recordedBy}</span></li>
		<li><span>Registrado el</span><span>{formatInstant(detail.recordedAt)}</span></li>
		<li>
			<span>{receiptTitle(detail)}</span><span>N.º {formatReceiptNumber(detail.receiptNumber)}</span
			>
		</li>
		{#if detail.reverses}
			<li><span>Corrige</span><span>{receiptName(detail.reverses)}</span></li>
		{/if}
		{#if detail.reversedBy}
			<li><span>Corregido con</span><span>{receiptName(detail.reversedBy)}</span></li>
		{/if}
		<li class="detail-list__row--strong">
			<span>Valor</span><span>{formatSignedPesos(detail.amount)}</span>
		</li>
	</ul>
	<div class="detail__actions">
		<!-- STUB: unit #193 (Recibo de caja y comprobante de egreso impresos, phase 07) makes this print the receipt. -->
		<Button type="button" variant="secondary" disabled>
			{0 < detail.amount ? 'Imprimir recibo de caja' : 'Imprimir comprobante de egreso'}
		</Button>
		{#if isReversible(detail)}
			<!-- STUB: unit #195 (Movimiento contrario, phase 07) pre-fills the tab from `?corrige=`. -->
			<Button
				variant="secondary"
				href="{resolve('/(app)/caja/registrar')}?{new URLSearchParams({
					corrige: String(detail.id)
				})}"
			>
				Registrar movimiento contrario
			</Button>
		{/if}
	</div>
	{#if isReversible(detail)}
		<p class="note">
			Los movimientos no se editan. Para corregir uno, registra el movimiento contrario.
		</p>
	{/if}
{/snippet}

<div class={['book', { 'book--detail': movement }]}>
	<div class="book__list">
		<Screen>
			{#snippet header()}
				<ScreenHeader>
					<Tabs tabs={CASH_TABS} current="Libro de caja" />
					<span class="phone-only">
						<IconButton icon="filter" label="Filtrar" onclick={() => (isSheetOpen = true)} />
					</span>
				</ScreenHeader>
			{/snippet}

			<div class="desktop-only">
				<div class="book__toolbar">
					<p class="book__period">{period}</p>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						inline
						aria-expanded={areFiltersShown}
						onclick={() => (areFiltersShown = !areFiltersShown)}
					>
						<Icon name="filter" size="sm" />
						{areFiltersShown ? 'Ocultar filtros' : 'Filtros'}{extraCount ? ` (${extraCount})` : ''}
					</Button>
				</div>
				{#if areFiltersShown}
					<!-- No apply button: a changed field reloads the book. -->
					<form
						method="GET"
						data-sveltekit-keepfocus
						data-sveltekit-noscroll
						onchange={submitOnChange}
					>
						{@render fields('desktop-', select)}
					</form>
				{/if}
				<div class="book__count">
					<p class="meta">
						{entries.length}
						{1 === entries.length ? 'movimiento' : 'movimientos'}{extras}
					</p>
					{#if extraCount}
						{@render clearFilters()}
					{/if}
				</div>
			</div>

			<p class="meta phone-only">Totales de {period}{extras}</p>

			<!-- The period's net, not a cash balance: it mixes cash with transfers. -->
			<div class="stat-grid">
				<div class="stat stat--income">
					<div class="stat__label">Entradas</div>
					<div class="stat__value">{formatPesos(totals.inflow)}</div>
				</div>
				<div class="stat stat--expense">
					<div class="stat__label">Salidas</div>
					<div class="stat__value">{formatPesos(totals.outflow)}</div>
				</div>
				<div class="stat">
					<div class="stat__label">Neto</div>
					<div class="stat__value">{net}</div>
				</div>
			</div>

			{#if 0 === entries.length}
				<div class="empty">
					<p class="meta">Ningún movimiento coincide con los filtros.</p>
					{@render clearFilters()}
				</div>
			{:else}
				<table class="table phone-only">
					<thead>
						<tr>
							<th>Fecha</th>
							<th>Movimiento</th>
							<th class="num">Valor</th>
						</tr>
					</thead>
					<tbody>
						{#each entries as entry (entry.id)}
							<tr>
								<td class="nowrap">
									{formatShortDay(entry.movementDate)}
									<div class="meta">{formatInstantTime(entry.recordedAt)}</div>
								</td>
								<td>
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- bookHref builds it with resolve() -->
									<a class="row-link" href={bookHref(entry.id)}
										>{CASH_CONCEPT_LABELS[entry.concept]}</a
									>
									<div class="meta">{summary(entry)}</div>
									<div class="meta">
										{joined(PAYMENT_METHOD_LABELS[entry.method], entry.recordedBy)}
									</div>
								</td>
								<td class="num nowrap">
									<b class={0 < entry.amount ? 'income' : 'expense'}>
										{formatSignedPesos(entry.amount)}
									</b>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>

				<table class="table desktop-only">
					<thead>
						<tr>
							<th>Fecha</th>
							<th>Concepto</th>
							<th class="num">Valor</th>
							<th>Método</th>
							<th>Relacionado</th>
							<th>Registró</th>
						</tr>
					</thead>
					<tbody>
						{#each entries as entry (entry.id)}
							<tr class={{ 'table__row--selected': entry.id === movement?.id }}>
								<td class="nowrap">
									{formatShortDay(entry.movementDate)}
									<div class="meta">{formatInstantTime(entry.recordedAt)}</div>
								</td>
								<td>
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- bookHref builds it with resolve() -->
									<a class="row-link" href={bookHref(entry.id)}
										>{CASH_CONCEPT_LABELS[entry.concept]}</a
									>
									<div class="meta">{entry.description ?? party(entry)}</div>
								</td>
								<td class="num nowrap">
									<b class={0 < entry.amount ? 'income' : 'expense'}>
										{formatSignedPesos(entry.amount)}
									</b>
								</td>
								<td>{PAYMENT_METHOD_LABELS[entry.method]}</td>
								<td>{link(entry)}</td>
								<td>{entry.recordedBy}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</Screen>
	</div>

	{#if movement}
		<div class="book__detail phone-only">
			<Screen>
				{#snippet header()}
					<ScreenHeader backHref={bookHref()} title={detailTitle(movement)} />
				{/snippet}
				{@render movementDetail(movement)}
			</Screen>
		</div>
		<aside class="book__panel desktop-only">
			<div class="panel__head">
				<h2 class="section-title">{detailTitle(movement)}</h2>
				<IconButton icon="close" label="Cerrar" href={bookHref()} />
			</div>
			{@render movementDetail(movement)}
		</aside>
	{/if}
</div>

<BottomSheet bind:open={isSheetOpen} title="Filtros">
	<form method="GET" data-sveltekit-noscroll onsubmit={() => (isSheetOpen = false)}>
		{@render fields('phone-', chips)}
		<div class="sheet__actions">
			<Button
				variant="secondary"
				href={resolve('/(app)/caja')}
				onclick={() => (isSheetOpen = false)}
			>
				Limpiar
			</Button>
			<Button type="submit">Ver movimientos</Button>
		</div>
	</form>
</BottomSheet>

<style>
	p {
		margin: 0;
	}

	/* The book and, once a movement is open, its detail: instead of the book on a phone, beside
	   it on a desktop. */
	.book,
	.book__list,
	.book__detail {
		height: 100%;
	}

	.book--detail .book__list {
		display: none;
	}

	.detail__actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		margin: var(--space-10) 0 var(--space-5);
	}

	/* The concept is the row's link, and its hit area covers the whole row. */
	.table tbody tr {
		position: relative;
	}

	.row-link {
		color: inherit;
		text-decoration: none;
	}

	.row-link::after {
		position: absolute;
		inset: 0;
		content: '';
	}

	.table__row--selected td {
		font-weight: var(--weight-bold);
		background: var(--surface-subtle);
	}

	.desktop-only {
		display: none;
	}

	.nowrap {
		white-space: nowrap;
	}

	.phone-only.meta {
		margin-bottom: var(--space-4);
	}

	/* Stat tiles: the period's totals. */
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-4);
	}

	.stat {
		min-width: 0;
		padding: var(--space-5);
		text-align: center;
		background: var(--surface-subtle);
		border-radius: var(--radius-input);
	}

	.stat__label {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.stat__value {
		font-weight: var(--weight-bold);
	}

	.stat--income .stat__value,
	.income {
		color: var(--income);
	}

	.stat--expense .stat__value,
	.expense {
		color: var(--expense);
	}

	.table {
		width: 100%;
		margin-top: var(--space-9);
		font-size: var(--text-md);
		border-collapse: collapse;
	}

	.table th {
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-label);
		font-weight: var(--weight-bold);
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

	.empty {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		align-items: center;
		margin-top: var(--space-12);
		text-align: center;
	}

	/* The filters: pairs side by side and the rest full width on a phone, a grid on a desktop. */
	.filters {
		display: flex;
		flex-direction: column;
		gap: var(--field-gap);
	}

	.field-row {
		display: flex;
		gap: var(--control-gap);
	}

	.choice {
		min-width: 0;
		padding: 0;
		margin: 0;
		border: 0;
	}

	/* The same look as a Field's label. */
	.choice__legend {
		padding: 0;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	.search {
		position: relative;
		display: block;
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

	.sheet__actions {
		display: flex;
		gap: var(--control-gap);
		margin-top: var(--space-9);
	}

	.sheet__actions > :global(:first-child) {
		flex: 1;
	}

	.sheet__actions > :global(:last-child) {
		flex: 2;
	}

	@container (width >= 1024px) {
		.phone-only,
		.phone-only.meta {
			display: none;
		}

		.desktop-only {
			display: block;
		}

		.book {
			display: flex;
		}

		.book__list {
			flex: 1;
			min-width: 0;
		}

		.book--detail .book__list {
			display: block;
		}

		.book__panel {
			box-sizing: border-box;
			flex: none;
			width: 340px;
			height: 100%;
			padding: var(--space-14) var(--space-12);
			overflow: auto;
			border-left: var(--border-w-hair) solid var(--border-default);
		}

		.panel__head {
			display: flex;
			gap: var(--space-4);
			align-items: center;
			justify-content: space-between;
			margin-bottom: var(--space-6);
		}

		.panel__head .section-title {
			margin: 0;
		}

		/* The panel is narrower than a button's cap: its buttons take its width. */
		.book__panel :global(.btn) {
			max-width: none;
		}

		.table.desktop-only {
			display: table;
		}

		.book__toolbar {
			display: flex;
			gap: var(--space-8);
			align-items: center;
			justify-content: space-between;
			margin-bottom: var(--space-9);
		}

		.book__period {
			font-size: var(--text-base);
			font-weight: var(--weight-semibold);
			color: var(--text-secondary);
		}

		.filters {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
			gap: var(--space-7);
		}

		/* The pairs become cells of the grid like every other field. */
		.field-row {
			display: contents;
		}

		.filters__search {
			grid-column: 1 / -1;
			max-width: 560px;
		}

		.book__count {
			display: flex;
			gap: var(--space-8);
			align-items: center;
			margin: var(--space-9) 0 var(--space-4);
		}

		.stat-grid {
			max-width: 560px;
		}
	}
</style>
