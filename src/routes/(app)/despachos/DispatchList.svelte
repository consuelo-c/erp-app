<script lang="ts">
	import { resolve } from '$app/paths';
	import Badge, { ORDER_STATUS_TONES } from '$lib/components/Badge.svelte';
	import Card from '$lib/components/Card.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { formatClockTime, formatLongDay, formatShortDay } from '$lib/datetime';
	import { DELIVERY_METHOD_LABELS, ORDER_STATUS_LABELS, RETURN_METHOD_LABELS } from '$lib/labels';
	import { DISPATCH_TABS } from '$lib/navigation';
	import { formatPhone } from '$lib/phone';
	import type { DispatchDay, DispatchRow } from '$lib/server/services/dispatch';
	import type { OrderStatus } from '$lib/server/services/orders';

	// One of Despachos' tabs: today's deliveries, then pickups, late ones first. A row only opens
	// its operational detail: the status changes there. `route` is the driver's: one list, what goes
	// out then what comes back, and a badge only once the order is on the street or at the client's.
	let {
		tab,
		day,
		empty,
		route = false
	}: { tab: string; day: DispatchDay; empty: string; route?: boolean } = $props();

	const sections = $derived(
		route
			? [{ title: null, rows: [...day.deliveries, ...day.pickups] }]
			: [
					{ title: '↧ Entregas', rows: day.deliveries },
					{ title: '↥ Recogidas', rows: day.pickups }
				]
	);
	const ROUTE_BADGES: OrderStatus[] = ['OUT_FOR_DELIVERY', 'DELIVERED', 'OUT_FOR_PICKUP'];
	const isEmpty = $derived(0 === day.deliveries.length + day.pickups.length);

	// «Transportador externo» reads the same both ways.
	const METHOD_LABELS = { ...DELIVERY_METHOD_LABELS, ...RETURN_METHOD_LABELS };

	function isCompanyTrip(row: DispatchRow): boolean {
		return 'COMPANY_DELIVERY' === row.method || 'COMPANY_PICKUP' === row.method;
	}

	function lateWhen(row: DispatchRow): string {
		const time = null === row.time ? '' : `, ${formatClockTime(row.time)}`;
		return `Atrasado · ${formatShortDay(row.date)}${time}`;
	}
</script>

<svelte:head>
	<title>{tab} · Despachos · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={DISPATCH_TABS} current={tab} /></ScreenHeader>
	{/snippet}

	<p class="meta today">Hoy · {formatLongDay(day.today)}</p>

	{#if isEmpty}
		<p class="empty">{empty}</p>
	{:else}
		{#each sections as section (section.title)}
			{#if section.title}
				<h2 class="section-title">{section.title} ({section.rows.length})</h2>
			{/if}
			{#each section.rows as row (row.id)}
				<Card href={resolve('/(app)/despachos/[id]', { id: String(row.id) })}>
					{#snippet head()}
						<b class="row__id">#{row.id}</b>
						<span class="badges">
							{#if !route || ROUTE_BADGES.includes(row.status)}
								<Badge tone={ORDER_STATUS_TONES[row.status]}>
									{ORDER_STATUS_LABELS[row.status]}
								</Badge>
							{/if}
							{#if row.hasIncident}
								<Badge tone="error">Con novedad</Badge>
							{/if}
						</span>
					{/snippet}
					{#if row.isLate}
						<p class="row__when row__when--late">{lateWhen(row)}</p>
					{:else if null === row.time}
						<p class="row__when row__when--none">Sin hora</p>
					{:else}
						<p class="row__when">{formatClockTime(row.time)}</p>
					{/if}
					<p class="row__client">{row.clientName}</p>
					{#if isCompanyTrip(row)}
						<p class="row__trip">{row.address1}</p>
						{#if row.address2}<p class="meta">{row.address2}</p>{/if}
					{:else}
						<p class="row__trip">{METHOD_LABELS[row.method]}</p>
						<!-- Text, not a link: the whole row is one. The detail has the links. -->
						{#if row.carrier}
							<p class="meta row__carrier">
								{row.carrier.name} · {formatPhone(row.carrier.phone)}
							</p>
						{/if}
					{/if}
					{#each row.extensionIds as extensionId (extensionId)}
						<p class="row__extension">Sigue en el pedido #{extensionId}</p>
					{/each}
				</Card>
			{/each}
		{/each}
	{/if}
</Screen>

<style>
	p {
		margin: 0;
	}

	.today {
		margin-bottom: var(--space-7);
	}

	.empty {
		padding: 72px 0 var(--space-10);
		font-size: var(--text-base);
		text-align: center;
	}

	.section-title ~ .section-title {
		margin-top: var(--space-11);
	}

	.badges {
		display: flex;
		flex: none;
		gap: var(--space-3);
	}

	.row__id,
	.row__when,
	.row__client,
	.row__trip {
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

	.row__trip {
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
