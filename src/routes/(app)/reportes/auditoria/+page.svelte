<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Input from '$lib/components/Input.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Select from '$lib/components/Select.svelte';
	import { formatInstantTime, formatLongDay, formatPeriod, getInstantDate } from '$lib/datetime';
	import { EVENT_ACTION_LABELS, EVENT_ENTITY_TYPE_LABELS } from '$lib/labels';
	import type { AuditEvent } from '$lib/server/services/reports';
	import type { PageProps } from './$types';

	// The Event log, newest first: each row a `<details>` opening to its raw before → after. The
	// filters are a GET form, so a filtered log is a URL: a grid on a desktop, folded on a phone.
	let { data }: PageProps = $props();

	const filters = $derived(data.filters);

	// The access Events, whose IP and browser say where a login came from.
	const ACCESS_ACTIONS = new Set(['LOGIN', 'LOGIN_FAILED', 'LOGOUT']);

	// The dates count as one filter, as in the other lists.
	const appliedCount = $derived(
		[filters.from || filters.to, filters.username, filters.entityType, filters.action].filter(
			Boolean
		).length
	);
	const countLabel = $derived(
		`${data.total} ${1 === data.total ? 'registro' : 'registros'} · página ${filters.page} de ${data.pageCount}`
	);
	const period = $derived(describePeriod(filters.from, filters.to));
	const clearHref = `${resolve('/reportes/auditoria')}?limpiar`;

	function describePeriod(from: string | undefined, to: string | undefined): string | undefined {
		if (from && to) {
			if (from !== to) {
				return formatPeriod(from, to);
			}
			return from === data.today ? 'Hoy' : formatLongDay(from);
		}
		if (from) {
			return `Desde ${formatLongDay(from)}`;
		}
		return to && `Hasta ${formatLongDay(to)}`;
	}

	function entityLabel(type: string): string {
		return EVENT_ENTITY_TYPE_LABELS[type as keyof typeof EVENT_ENTITY_TYPE_LABELS] ?? type;
	}

	function actionLabel(action: string): string {
		return EVENT_ACTION_LABELS[action as keyof typeof EVENT_ACTION_LABELS] ?? action;
	}

	function formatWhen(createdAt: number): string {
		return `${formatLongDay(getInstantDate(createdAt))} · ${formatInstantTime(createdAt)}`;
	}

	function formatValue(value: string | number | null): string {
		return null === value ? '—' : String(value);
	}

	// Another page of the same filters.
	function pageHref(pageNumber: number): string {
		const kept = [...page.url.searchParams].filter(([name]) => 'pagina' !== name);
		const turned = 1 === pageNumber ? [] : [['pagina', String(pageNumber)]];
		return `?${new URLSearchParams([...kept, ...turned])}`;
	}

	function submitOnChange(event: Event & { currentTarget: HTMLFormElement }) {
		event.currentTarget.requestSubmit();
	}
</script>

<svelte:head>
	<title>Auditoría · Banquetes Consuelo C</title>
</svelte:head>

{#snippet fields(prefix: string)}
	<div class="field-row">
		<Field label="Desde" id="{prefix}desde">
			<Input id="{prefix}desde" name="desde" type="date" value={filters.from ?? ''} />
		</Field>
		<Field label="Hasta" id="{prefix}hasta">
			<Input id="{prefix}hasta" name="hasta" type="date" value={filters.to ?? ''} />
		</Field>
	</div>
	<!-- '' is «no filter». -->
	<Field label="Usuario" id="{prefix}usuario">
		<Select id="{prefix}usuario" name="usuario" value={filters.username ?? ''}>
			<option value="">Todos</option>
			{#each data.usernames as username (username)}
				<option value={username}>{username}</option>
			{/each}
		</Select>
	</Field>
	<Field label="Registro" id="{prefix}registro">
		<Select id="{prefix}registro" name="registro" value={filters.entityType ?? ''}>
			<option value="">Todos</option>
			{#each Object.entries(EVENT_ENTITY_TYPE_LABELS) as [type, label] (type)}
				<option value={type}>{label}</option>
			{/each}
		</Select>
	</Field>
	<Field label="Acción" id="{prefix}accion">
		<Select id="{prefix}accion" name="accion" value={filters.action ?? ''}>
			<option value="">Todas</option>
			{#each Object.entries(EVENT_ACTION_LABELS) as [action, label] (action)}
				<option value={action}>{label}</option>
			{/each}
		</Select>
	</Field>
{/snippet}

{#snippet row(event: AuditEvent)}
	<details class="event">
		<summary class="event__summary">
			<span class="event__when">{formatWhen(event.createdAt)}</span>
			<span class="event__user">{event.username}</span>
			<span class="event__what"
				><b>{entityLabel(event.entityType)}</b> · {actionLabel(event.action)}</span
			>
			<span class="event__link">
				{#if event.link}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the service builds it with resolve() -->
					<a href={event.link.href}>{event.link.label}</a>
				{:else}
					<span class="meta">sin página</span>
				{/if}
			</span>
		</summary>
		<div class="event__body">
			{#if 0 < event.changes.length}
				<table class="event__changes">
					<tbody>
						{#each event.changes as change (change.column)}
							<tr>
								<td><code>{change.column}</code></td>
								<td><code>{formatValue(change.before)}</code></td>
								<td aria-hidden="true">→</td>
								<td><code>{formatValue(change.after)}</code></td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			{#if event.reason || ACCESS_ACTIONS.has(event.action)}
				<ul class="detail-list">
					{#if event.reason}
						<li class="detail-list__row--plain"><span>Motivo</span><span>{event.reason}</span></li>
					{/if}
					{#if ACCESS_ACTIONS.has(event.action)}
						<li class="detail-list__row--plain">
							<span>IP</span><span><code>{event.ip ?? '—'}</code></span>
						</li>
						<li class="detail-list__row--plain">
							<span>Navegador</span><span class="event__agent"
								><code>{event.userAgent ?? '—'}</code></span
							>
						</li>
					{/if}
				</ul>
			{/if}
		</div>
	</details>
{/snippet}

<Screen>
	{#snippet header()}
		<ScreenHeader title="Auditoría" />
	{/snippet}

	<!-- No apply button: a changed field reloads the log from its first page. -->
	<form
		class="filters desktop-only"
		method="GET"
		data-sveltekit-keepfocus
		data-sveltekit-noscroll
		onchange={submitOnChange}
	>
		{@render fields('desktop-')}
	</form>

	<details class="filters-fold phone-only">
		<summary class="filters-fold__button">
			<Icon name="filter" size="sm" />
			Filtros{0 < appliedCount ? ` (${appliedCount})` : ''}
		</summary>
		<form
			class="form-stack filters-fold__form"
			method="GET"
			data-sveltekit-noscroll
			onchange={submitOnChange}
		>
			{@render fields('phone-')}
			<Button variant="secondary" size="sm" inline href={clearHref}>Limpiar filtros</Button>
		</form>
	</details>

	{#if 0 === data.events.length}
		<div class="none">
			<p class="meta">Ningún registro coincide con los filtros.</p>
			<Button variant="secondary" inline href={clearHref}>Limpiar filtros</Button>
		</div>
	{:else}
		<div class="count">
			<p class="meta phone-only">{[period, countLabel].filter(Boolean).join(' · ')}</p>
			<p class="meta desktop-only">{countLabel}</p>
			<span class="desktop-only">
				<Button variant="secondary" size="sm" inline href={clearHref}>Limpiar filtros</Button>
			</span>
		</div>

		<div class="events">
			{#each data.events as event (event.id)}
				{@render row(event)}
			{/each}
		</div>

		<div class="pages">
			<Pagination current={filters.page} count={data.pageCount} href={pageHref} />
		</div>
	{/if}
</Screen>

<style>
	p {
		margin: 0;
	}

	.desktop-only {
		display: none;
	}

	.filters-fold__button {
		box-sizing: border-box;
		display: inline-flex;
		gap: var(--space-4);
		align-items: center;
		padding: var(--button-pad-sm);
		font: var(--weight-semibold) var(--text-sm) / 1.2 var(--font-sans);
		color: var(--text-body);
		cursor: pointer;
		user-select: none;
		list-style: none;
		border: var(--border-w) solid var(--action-secondary-border);
		border-radius: var(--radius-card);
	}

	.filters-fold__button::-webkit-details-marker {
		display: none;
	}

	.filters-fold__form {
		margin-top: var(--space-6);
	}

	.field-row {
		display: flex;
		gap: var(--control-gap);
	}

	.count {
		display: flex;
		gap: var(--space-7);
		align-items: center;
		margin: var(--space-7) 0 var(--space-4);
	}

	.none {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
		align-items: center;
		padding: var(--space-14) 0 var(--space-12);
		text-align: center;
	}

	.events {
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.event {
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	/* A phone: the time across the top, then what changed and its record. */
	.event__summary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-2) var(--space-6);
		align-items: baseline;
		padding: var(--space-6) var(--space-2);
		font-size: var(--text-base);
		cursor: pointer;
		list-style: none;
	}

	.event__summary::-webkit-details-marker {
		display: none;
	}

	.event__when {
		grid-column: 1 / -1;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.event__user {
		display: none;
	}

	.event__link {
		text-align: right;
	}

	.event__body {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		padding: 0 var(--space-2) var(--space-7);
		font-size: var(--text-xs);
	}

	.event__changes {
		border-collapse: collapse;
	}

	.event__changes td {
		padding: var(--space-1) var(--space-6) var(--space-1) 0;
		vertical-align: top;
	}

	.event code {
		padding: 1px 5px;
		font-family: var(--font-mono);
		overflow-wrap: anywhere;
		background: var(--surface-subtle);
		border-radius: var(--radius-sm);
	}

	.event__agent {
		max-width: 420px;
	}

	.pages {
		margin-top: var(--space-8);
	}

	@container (width >= 1024px) {
		.phone-only {
			display: none;
		}

		.desktop-only {
			display: block;
		}

		.filters {
			display: grid;
			grid-template-columns: repeat(5, minmax(0, 1fr));
			gap: var(--space-7);
			align-items: end;
		}

		/* The two dates become cells of the grid like every other field. */
		.field-row {
			display: contents;
		}

		.count {
			margin-top: var(--space-9);
		}

		.event__summary {
			grid-template-columns: 230px 120px minmax(0, 1fr) 200px;
			font-size: var(--text-md);
		}

		.event__when {
			grid-column: auto;
		}

		.event__user {
			display: inline;
		}

		.event__body {
			font-size: var(--text-sm);
		}
	}
</style>
