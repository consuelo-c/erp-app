<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Select from '$lib/components/Select.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import WeekPicker from '$lib/components/WeekPicker.svelte';
	import { addDays, formatLongDay, formatShortDay, getWeekStart } from '$lib/datetime';
	import { formatInteger, formatPesos } from '$lib/format';
	import {
		CASH_CONCEPT_LABELS,
		DEDUCTION_LABELS,
		EARNING_LABELS,
		PAYMENT_METHOD_LABELS,
		PAYROLL_STATUS_LABELS
	} from '$lib/labels';
	import { PERSONAL_TABS } from '$lib/navigation';
	import {
		calculateSettlement,
		parsePesos,
		parseQuantity,
		roundToMinute,
		type SettlementInput
	} from '$lib/payroll';
	import type { DeductionRow, Draft, EarningRow } from '$lib/server/services/payroll';
	import type { SubmitFunction } from '@sveltejs/kit';
	import PaidSettlement from './PaidSettlement.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const week = $derived(data.week);
	const draft = $derived(data.week.draft);

	// The form as typed, read on every keystroke; back to the server's values whenever the page loads
	// again: a save, another employee or another week.
	let entered = $derived.by((): FormData | null => {
		void data.week;
		return null;
	});
	const isRecalculated = $derived(null !== entered && 'DRAFT' === draft?.status);
	// What the screen shows: the server's settlement, or the one typed so far.
	const shown = $derived(isRecalculated ? recalculate(draft!, entered!) : draft);

	// The form's text as the calculation's input, read the way saving reads it. Text that isn't a
	// quantity counts 0 until saving says why.
	function readEntered(saved: Draft, form: FormData): SettlementInput {
		const text = (name: string) => String(form.get(name) ?? '');
		const quantityOf = ({ concept, derivedQty }: EarningRow) => {
			const qty = Math.max(0, parseQuantity(text(concept)) || 0);
			return null === derivedQty ? qty : roundToMinute(qty);
		};
		const quantities = Object.fromEntries(
			saved.earnings
				.filter(({ qty }) => null !== qty)
				.map((line) => [line.concept, quantityOf(line)])
		) as SettlementInput['quantities'];
		return {
			monthlySalary: saved.monthlySalary,
			quantities,
			nonSalaryBonus: parsePesos(text('NON_SALARY_BONUS')),
			loans: parsePesos(text('LOANS')),
			other: parsePesos(text('OTHER'))
		};
	}

	// The same calculation saving runs, over what's typed.
	function recalculate(saved: Draft, form: FormData): Draft {
		const settlement = calculateSettlement(readEntered(saved, form), saved.parameters);
		const find = <Line extends { concept: string }>(lines: Line[], concept: string) =>
			lines.find((line) => concept === line.concept)!;
		return {
			...saved,
			earnings: saved.earnings.map((line) => {
				const { qty, amount } = find(settlement.earnings, line.concept);
				return { ...line, qty: qty ?? null, amount };
			}),
			deductions: saved.deductions.map((line) => ({
				...line,
				amount: find(settlement.deductions, line.concept).amount
			})),
			totalEarnings: settlement.totalEarnings,
			totalDeductions: settlement.totalDeductions,
			netPay: settlement.netPay
		};
	}

	// Every link keeps the chosen employee.
	function weekHref(periodStart: string): string {
		const employee: Record<string, string> = draft ? { empleado: String(draft.employeeId) } : {};
		return `${resolve('/(app)/nomina')}?${new URLSearchParams({ semana: periodStart, ...employee })}`;
	}

	// After a failed save the fields come back with what was typed.
	const typed = (name: string, saved: string) => String(form?.values?.[name] ?? saved);
	const errorOf = (name: string): string | undefined => form?.errors?.[name];

	// Hours rows are whole minutes: two decimals map back to the exact minute.
	const formatQuantity = (qty: number) => String(Math.round(qty * 100) / 100);
	// An hours row the manager changed: the hours log's value shows next to it.
	const isCorrected = (line: EarningRow) =>
		null !== line.derivedQty && line.qty !== line.derivedQty;
	// Pension and health are calculated; loans and «Otros» are typed in, with a description.
	const isContribution = (line: DeductionRow) =>
		'PENSION' === line.concept || 'HEALTH' === line.concept;
	const formatTypedPesos = (amount: number) => (0 === amount ? '' : formatInteger(amount));

	const proposalHint = $derived(
		null === draft?.previousWeekNumber
			? 'Semana propuesta: 1, la primera del año.'
			: `Semana propuesta: la anterior (${draft?.previousWeekNumber}) + 1.`
	);

	// How it's paid, as typed. A transfer is the default when the employee has an account on file.
	const enteredText = (name: string, saved: string) =>
		String(entered?.get(name) ?? typed(name, saved));
	const method = $derived(
		enteredText('payment_method', draft?.employeeBankAccount ? 'TRANSFER' : 'CASH')
	);
	const methods = Object.entries(PAYMENT_METHOD_LABELS);
	const methodLabel = $derived(
		'OTHER' === method
			? enteredText('payment_method_other', '') || PAYMENT_METHOD_LABELS.OTHER
			: PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS]
	);
	const employeeName = $derived(
		week.employees.find((employee) => draft?.employeeId === employee.id)?.fullName
	);

	let confirmOpen = $state(false);

	// The fields are checked before asking, since the dialog covers them.
	function askToConfirm(event: MouseEvent) {
		if ((event.currentTarget as HTMLButtonElement).form?.reportValidity()) {
			confirmOpen = true;
		}
	}

	// Saving stays on the screen: the fields keep what was typed until the reloaded values replace it.
	// The dialog closes once the server answers; an error shows above the buttons.
	const keepValues: SubmitFunction = () => {
		return async ({ update }) => {
			await update({ reset: false });
			confirmOpen = false;
		};
	};
</script>

<svelte:head>
	<title>Liquidación semanal · Banquetes Consuelo C</title>
</svelte:head>

<!-- Only a draft has the side column. -->
<Screen wide={null !== draft && null === draft.payment}>
	{#snippet header()}
		<ScreenHeader>
			<Tabs tabs={PERSONAL_TABS} current="Nómina" />
			{#if draft}
				<Badge tone={'PAID' === draft.status ? 'success' : undefined}>
					{PAYROLL_STATUS_LABELS[draft.status]}
				</Badge>
			{/if}
		</ScreenHeader>
	{/snippet}

	<UnsavedChangesGuard form="settlement" />

	{#if draft}
		<!-- One employee at a time, and picking the wrong one is the costly mistake: the selector
		     comes first. Choosing loads that employee's settlement; without JS, «Ver» does it. -->
		<form class="payroll__selector" method="GET">
			<input type="hidden" name="semana" value={week.periodStart} />
			<Field label="Empleado" id="empleado">
				<Select
					id="empleado"
					name="empleado"
					value={String(draft.employeeId)}
					onchange={(event) => event.currentTarget.form?.requestSubmit()}
				>
					{#each week.employees as employee (employee.id)}
						<option value={String(employee.id)}>{employee.fullName} — {employee.position}</option>
					{/each}
				</Select>
			</Field>
			<noscript><Button type="submit" variant="secondary" size="sm" inline>Ver</Button></noscript>
		</form>
	{/if}

	<WeekPicker
		title="Periodo salarial"
		range="{formatShortDay(week.periodStart)} – {formatLongDay(week.periodEnd)}"
		previousHref={weekHref(addDays(week.periodStart, -7))}
		nextHref={week.periodStart < getWeekStart(data.today)
			? weekHref(addDays(week.periodStart, 7))
			: null}
	/>
	<p class="meta">
		Horas extras que paga: {formatShortDay(week.extraHours.start)} – {formatShortDay(
			week.extraHours.end
		)}
	</p>

	{#if null === draft || null === shown}
		<div class="payroll__notice">
			<Notice tone="info">Nadie trabajó en este periodo</Notice>
		</div>
	{:else if draft.payment}
		<PaidSettlement {week} {draft} payment={draft.payment} />
	{:else}
		<form
			id="settlement"
			method="POST"
			action="?/guardar"
			use:enhance={keepValues}
			oninput={(event) => (entered = new FormData(event.currentTarget))}
		>
			{#if form?.saved}
				<div class="payroll__notice">
					<Notice tone="success">Borrador guardado con éxito</Notice>
				</div>
			{/if}
			<input type="hidden" name="employee_id" value={draft.employeeId} />
			<input type="hidden" name="period_start" value={week.periodStart} />

			<div class="payroll__layout">
				<div class="payroll__lines">
					<div class="form-stack payroll__fields">
						<div class="payroll__row">
							<div class="payroll__week">
								<Field label="Semana" id="week_number" error={errorOf('week_number')}>
									<Input
										id="week_number"
										name="week_number"
										inputmode="numeric"
										value={typed('week_number', String(draft.weekNumber))}
										aria-invalid={undefined !== errorOf('week_number')}
										required
									/>
								</Field>
							</div>
							<Field label="Fecha de pago" id="payment_date" error={errorOf('payment_date')}>
								<Input
									id="payment_date"
									name="payment_date"
									type="date"
									value={typed('payment_date', draft.paymentDate)}
									aria-invalid={undefined !== errorOf('payment_date')}
									required
								/>
							</Field>
						</div>
						{#if !draft.isSaved}
							<p class="field__hint">{proposalHint}</p>
						{/if}
					</div>

					<table class="table payroll__table">
						<thead>
							<tr><th>DEVENGADOS</th><th class="num">Cant.</th><th class="num">Valor</th></tr>
						</thead>
						<tbody>
							<!-- The inputs keep the saved values; the amounts follow what's typed. -->
							{#each draft.earnings as line, index (line.concept)}
								{@const current = shown.earnings[index]}
								{@const error = errorOf(line.concept)}
								<tr>
									<td>
										{EARNING_LABELS[line.concept]}
										{#if isCorrected(current)}
											<div class="meta">calculado: {formatQuantity(current.derivedQty ?? 0)} h</div>
										{/if}
									</td>
									{#if null === line.qty}
										<td class="num">—</td>
										<td class="num">
											<div class="payroll__amount">
												<span class="meta">$</span>
												<Input
													name={line.concept}
													inputmode="numeric"
													placeholder="0"
													aria-label="Valor"
													value={typed(line.concept, formatTypedPesos(line.amount))}
													aria-invalid={undefined !== error}
												/>
											</div>
										</td>
									{:else}
										<td class="num">
											<div class="payroll__quantity">
												<Input
													name={line.concept}
													inputmode="decimal"
													aria-label="Cantidad"
													value={typed(line.concept, formatQuantity(line.qty))}
													aria-invalid={undefined !== error}
												/>
												<span class="meta">{null === line.derivedQty ? 'd' : 'h'}</span>
											</div>
											{#if error}<p class="field__error">{error}</p>{/if}
										</td>
										<td class="num">{formatPesos(current.amount)}</td>
									{/if}
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<td colspan="2">Total devengado</td>
								<td class="num">{formatPesos(shown.totalEarnings)}</td>
							</tr>
						</tfoot>
					</table>

					<table class="table payroll__table">
						<thead>
							<tr><th>DEDUCCIONES</th><th class="num">Cant.</th><th class="num">Valor</th></tr>
						</thead>
						<tbody>
							{#each draft.deductions as line, index (line.concept)}
								{#if isContribution(line)}
									{@const { PAYROLL_PENSION_RATE, PAYROLL_HEALTH_RATE } = shown.parameters}
									<tr>
										<td>{DEDUCTION_LABELS[line.concept]}</td>
										<td class="num">
											{'PENSION' === line.concept ? PAYROLL_PENSION_RATE : PAYROLL_HEALTH_RATE} %
										</td>
										<td class="num">{formatPesos(shown.deductions[index].amount)}</td>
									</tr>
								{:else}
									{@const name = `${line.concept}.description`}
									{@const error = errorOf(name)}
									<tr>
										<td colspan="2">
											<div class="payroll__described">
												<span class="payroll__concept">{DEDUCTION_LABELS[line.concept]}</span>
												<Input
													{name}
													aria-label="Descripción"
													placeholder={'OTHER' === line.concept
														? 'Descripción (obligatoria)'
														: 'Descripción (opcional)'}
													value={typed(name, line.description ?? '')}
													aria-invalid={undefined !== error}
												/>
											</div>
											{#if error}<p class="field__error">{error}</p>{/if}
										</td>
										<td class="num">
											<div class="payroll__amount">
												<span class="meta">$</span>
												<Input
													name={line.concept}
													inputmode="numeric"
													placeholder="0"
													aria-label="Valor"
													value={typed(line.concept, formatTypedPesos(line.amount))}
												/>
											</div>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<td colspan="2">Total deducciones</td>
								<td class="num">{formatPesos(shown.totalDeductions)}</td>
							</tr>
						</tfoot>
					</table>
				</div>

				<!-- On a wide screen what's paid stays in view while the lines are corrected. -->
				<aside class="payroll__side">
					<div class="summary-row summary-row--net">
						<span>Neto a pagar</span><span>{formatPesos(shown.netPay)}</span>
					</div>

					<h2 class="section-title payroll__title">Pago</h2>
					<div class="form-stack">
						<Field label="Medio de pago" id="payment_method" error={errorOf('payment_method')}>
							<Select id="payment_method" name="payment_method" value={method}>
								{#each methods as [value, label] (value)}
									<option {value}>{label}</option>
								{/each}
							</Select>
						</Field>
						{#if 'TRANSFER' === method}
							<Field
								label="Cuenta"
								id="bank_account"
								hint={draft.employeeBankAccount
									? 'Tomada de los datos del empleado. Puedes cambiarla para este pago.'
									: undefined}
								error={errorOf('bank_account')}
							>
								<Input
									id="bank_account"
									name="bank_account"
									value={typed('bank_account', draft.employeeBankAccount ?? '')}
									aria-invalid={undefined !== errorOf('bank_account')}
								/>
							</Field>
						{:else if 'OTHER' === method}
							<Field
								label="¿Cuál medio de pago?"
								id="payment_method_other"
								error={errorOf('payment_method_other')}
							>
								<Input
									id="payment_method_other"
									name="payment_method_other"
									value={typed('payment_method_other', '')}
									aria-invalid={undefined !== errorOf('payment_method_other')}
								/>
							</Field>
						{/if}
					</div>

					{#if form?.message}
						<div class="payroll__notice">
							<Notice tone="error">{form.message}</Notice>
						</div>
					{/if}

					<div class="screen__action payroll__actions">
						<Button type="submit" variant="secondary">Guardar borrador</Button>
						<Button type="button" onclick={askToConfirm}>Registrar pago</Button>
					</div>
					<p class="note payroll__note">Al registrar el pago la liquidación queda congelada.</p>
				</aside>
			</div>
		</form>

		<Modal bind:open={confirmOpen} title="Registrar pago" body={confirmation}>
			<p class="payroll__amount-due">{formatPesos(shown.netPay)}</p>
			<ul class="detail-list">
				<li><span>Concepto</span><span>{CASH_CONCEPT_LABELS.PAYROLL}</span></li>
				<li><span>Medio de pago</span><span>{methodLabel}</span></li>
				{#if 'TRANSFER' === method}
					<li>
						<span>Cuenta</span>
						<span>{enteredText('bank_account', draft.employeeBankAccount ?? '')}</span>
					</li>
				{/if}
			</ul>
			{#snippet actions()}
				<Button type="button" variant="secondary" onclick={() => (confirmOpen = false)}>
					Cancelar
				</Button>
				<Button type="submit" form="settlement" formaction="?/pagar" size="md">
					Registrar pago
				</Button>
			{/snippet}
		</Modal>
	{/if}
</Screen>

{#snippet confirmation()}
	Los pagos <b>no se pueden corregir</b> después. La liquidación de {employeeName}, semana
	{enteredText('week_number', String(draft?.weekNumber))}, queda congelada.
{/snippet}

<style>
	.payroll__selector {
		margin-bottom: var(--section-gap);
	}

	.payroll__selector :global(.select) {
		font-weight: var(--weight-bold);
	}

	.payroll__notice {
		margin-block: var(--space-5);
	}

	.payroll__fields {
		margin-top: var(--space-8);
	}

	.payroll__title {
		margin: var(--space-12) 0 var(--space-6);
	}

	.payroll__actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.payroll__amount-due {
		margin: 0 0 var(--space-5);
		font: var(--type-net);
	}

	@container (width >= 1024px) {
		.payroll__actions {
			flex-direction: row;
			justify-content: flex-end;
		}

		.payroll__note {
			text-align: right;
		}
	}

	/* The payment in a side column, beside the lines: the column narrows, so the buttons stack. */
	@container (width >= 1280px) {
		.payroll__layout {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 320px;
			gap: var(--space-12);
			align-items: start;
		}

		.payroll__side {
			position: sticky;
			top: 0;
		}

		.payroll__side > .summary-row--net {
			margin-top: var(--space-8);
		}

		.payroll__actions {
			flex-direction: column;
			align-items: stretch;
		}

		.payroll__actions :global(.btn) {
			max-width: none;
		}

		.payroll__note {
			text-align: left;
		}
	}

	.payroll__row {
		display: flex;
		gap: var(--control-gap);
	}

	.payroll__week {
		flex: none;
		width: 110px;
	}

	.field__hint {
		margin: 0;
		font-size: var(--text-label);
		font-style: italic;
		color: var(--text-secondary);
	}

	.field__error {
		margin: var(--space-3) 0 0;
		font-size: var(--text-label);
		font-weight: var(--weight-semibold);
		color: var(--error-fg);
		text-align: left;
	}

	.table {
		width: 100%;
		margin-top: var(--space-12);
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
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.table tfoot td {
		font-weight: var(--weight-bold);
		border-top: var(--border-w-strong) solid var(--border-strong);
		border-bottom: 0;
	}

	.table .num {
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}

	/* The system's .input--compact, narrow and right-aligned inside a number cell. */
	.payroll__table :global(.input) {
		padding: var(--space-5) var(--space-6);
	}

	.payroll__quantity,
	.payroll__amount {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		justify-content: flex-end;
	}

	.payroll__quantity :global(.input) {
		width: 64px;
		text-align: right;
	}

	.payroll__amount :global(.input) {
		width: 96px;
		text-align: right;
	}

	.payroll__described {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3) var(--space-6);
		align-items: center;
	}

	.payroll__concept {
		flex: none;
		width: 90px;
	}

	.payroll__described :global(.input) {
		flex: 1;
		min-width: 0;
	}

	.summary-row {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		justify-content: space-between;
		margin-top: var(--space-12);
		font-size: var(--text-base);
		color: var(--text-secondary);
	}

	.summary-row--net {
		padding: var(--space-10) var(--space-12);
		font-weight: var(--weight-semibold);
		line-height: 1.2;
		color: var(--text-body);
		background: var(--surface-highlight);
		border: var(--border-w-strong) solid var(--brand-yellow);
		border-radius: var(--radius-net);
	}

	.summary-row--net > :last-child {
		font: var(--type-net);
	}
</style>
