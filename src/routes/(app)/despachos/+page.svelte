<script lang="ts">
	import { resolve } from '$app/paths';
	import Badge, { ORDER_STATUS_TONES } from '$lib/components/Badge.svelte';
	import Card from '$lib/components/Card.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatClockTime, formatInstantTime, formatLongDay, formatShortDay } from '$lib/datetime';
	import { DELIVERY_METHOD_LABELS, ORDER_STATUS_LABELS, RETURN_METHOD_LABELS } from '$lib/labels';
	import { formatPhone } from '$lib/phone';
	import type { DispatchRow } from '$lib/server/services/dispatch';
	import type { PageProps } from './$types';

	// One day's deliveries and pickups, mixed by time, whoever moves them: today's late ones first,
	// any other day picked above. A row only opens its operational detail: the status changes there.
	let { data }: PageProps = $props();

	const day = $derived(data.day);
	const isToday = $derived(day.date === day.today);
	const DIRECTION_LABELS = { delivery: '↧ Entrega', pickup: '↥ Recogida' };

	// The row remembers its day, so the detail's «Atrás» comes back to it. Today has no `?fecha=`.
	function rowHref(row: DispatchRow): string {
		const href = resolve('/(app)/despachos/[id]', { id: String(row.id) });
		return isToday ? href : `${href}?${new URLSearchParams({ fecha: day.date })}`;
	}

	function methodLabel(row: DispatchRow): string {
		return 'delivery' === row.direction
			? DELIVERY_METHOD_LABELS[row.method]
			: RETURN_METHOD_LABELS[row.method];
	}

	function isCompanyTrip(row: DispatchRow): boolean {
		return 'COMPANY_DELIVERY' === row.method || 'COMPANY_PICKUP' === row.method;
	}

	function when(row: DispatchRow): string {
		const time = null === row.time ? null : formatClockTime(row.time);
		if (row.isLate) {
			return `Atrasado · ${formatShortDay(row.date)}${null === time ? '' : `, ${time}`}`;
		}
		return time ?? 'Sin hora';
	}

	// The picked day opens at once: the form is only how the browser builds `?fecha=`.
	function pick(event: Event & { currentTarget: HTMLInputElement }) {
		event.currentTarget.form?.requestSubmit();
	}
</script>

<svelte:head>
	<title>Despachos · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Despachos" />
	{/snippet}

	<!-- No signal: today's copy from the phone, as it was when it was saved. -->
	{#if null !== data.capturedAt}
		<div class="offline">
			<Notice tone="warning">
				Sin señal · Datos de las {formatInstantTime(data.capturedAt)}. Para marcar un pedido hace
				falta señal.
			</Notice>
		</div>
	{/if}

	<div class="day">
		<p class="meta">
			{isToday ? `Hoy · ${formatLongDay(day.today)}` : formatLongDay(day.date)}
		</p>
		{#if !isToday}
			<a
				class="day__today"
				href="{resolve('/despachos')}?{new URLSearchParams({ fecha: day.today })}">Volver a hoy</a
			>
		{/if}
		<form class="day__picker" method="get">
			<Input type="date" name="fecha" value={day.date} aria-label="Día" onchange={pick} />
		</form>
	</div>

	{#each day.rows as row (`${row.direction}-${row.id}`)}
		<Card href={rowHref(row)} modified={row.modifiedAfterStaging}>
			{#snippet head()}
				<b class="row__id">#{row.id}</b>
				<span class="badges">
					<Badge tone={ORDER_STATUS_TONES[row.status]}>{ORDER_STATUS_LABELS[row.status]}</Badge>
					{#if row.hasIncident}
						<Badge tone="error">Con novedad</Badge>
					{/if}
				</span>
			{/snippet}
			<p
				class={[
					'row__when',
					row.isLate && 'row__when--late',
					!row.isLate && null === row.time && 'row__when--none'
				]}
			>
				{DIRECTION_LABELS[row.direction]} · {when(row)}
			</p>
			<p class="row__client">{row.clientName}</p>
			<p class="row__method">{methodLabel(row)}</p>
			<!-- A client's trip happens at the warehouse: nothing more to say. -->
			{#if isCompanyTrip(row)}
				<p class="row__address">{row.address1}</p>
				{#if row.address2}<p class="meta">{row.address2}</p>{/if}
			{:else if row.carrier}
				<!-- Text, not a link: the whole row is one. The detail has the links. -->
				<p class="meta row__carrier">{row.carrier.name} · {formatPhone(row.carrier.phone)}</p>
			{/if}
			{#each row.extensionIds as extensionId (extensionId)}
				<p class="row__extension">Sigue en el pedido #{extensionId}</p>
			{/each}
		</Card>
	{:else}
		<p class="empty">{isToday ? 'Hoy' : 'Este día'} no hay entregas ni recogidas.</p>
	{/each}
</Screen>

<style>
	p {
		margin: 0;
	}

	.offline {
		margin-bottom: var(--space-7);
	}

	.day {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4) var(--space-6);
		align-items: center;
		margin-bottom: var(--space-7);
	}

	.day__today {
		font-weight: var(--weight-semibold);
	}

	.day__picker {
		width: 11rem;
		margin-left: auto;
	}

	.empty {
		padding: 72px 0 var(--space-10);
		font-size: var(--text-base);
		text-align: center;
	}

	.badges {
		display: flex;
		flex: none;
		gap: var(--space-3);
	}

	.row__id,
	.row__when,
	.row__client,
	.row__method,
	.row__address {
		font-size: var(--text-base);
	}

	.row__when {
		font-weight: var(--weight-bold);
	}

	.row__when--late {
		color: var(--warning-fg);
	}

	.row__when--none {
		font-weight: var(--weight-semibold);
		color: var(--text-secondary);
	}

	.row__client {
		margin-top: var(--space-1);
	}

	.row__method {
		margin-top: var(--space-4);
	}

	.row__carrier {
		color: var(--text-body);
	}

	.row__extension {
		margin-top: var(--space-4);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
	}
</style>
