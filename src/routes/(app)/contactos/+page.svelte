<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { SERVICE_LABELS, SERVICE_PLURAL_LABELS } from '$lib/labels';
	import { formatPhone } from '$lib/phone';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const filters = $derived(data.filters);
	const isFiltered = $derived('' !== filters.search || undefined !== filters.service);
	// No contact at all, as opposed to none matching: the search has nothing to narrow.
	const isEmpty = $derived(!isFiltered && 0 === data.contacts.length);

	const noneText = $derived.by(() => {
		const { search, service } = filters;
		if ('' === search) {
			return `Aún no hay ningún ${service ? SERVICE_LABELS[service].toLowerCase() : 'contacto'}.`;
		}
		const among = service ? ` entre los ${SERVICE_PLURAL_LABELS[service]}` : '';
		return `Nadie coincide con «${search}»${among}.`;
	});

	// «Cargar más» asks for one page more of the same filters.
	const moreHref = $derived.by(() => {
		const kept = [...page.url.searchParams].filter(([name]) => 'paginas' !== name);
		return `?${new URLSearchParams([...kept, ['paginas', String(filters.pages + 1)]])}`;
	});

	let typing: ReturnType<typeof setTimeout> | undefined;

	// The list narrows as it's typed, once the typing pauses; a service applies when picked.
	function searchSoon(event: Event & { currentTarget: HTMLInputElement }) {
		const { form } = event.currentTarget;
		clearTimeout(typing);
		typing = setTimeout(() => form?.requestSubmit(), 300);
	}

	function apply(event: Event & { currentTarget: HTMLInputElement }) {
		event.currentTarget.form?.requestSubmit();
	}
</script>

<svelte:head>
	<title>Contactos · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Contactos" />
	{/snippet}

	<!-- Set by the contact form's redirect after a save. -->
	{#if page.url.searchParams.has('guardado')}
		<div class="saved"><Notice tone="success">Contacto guardado con éxito</Notice></div>
	{/if}

	{#if isEmpty}
		<!-- Empty state: the action sits centered under the message. -->
		<div class="empty">
			<p><strong>Aún no hay contactos</strong></p>
			<p class="meta">Crea el primero con Nuevo contacto.</p>
			<div class="empty__action">{@render newContact()}</div>
		</div>
	{:else}
		<!-- Each filter is in the URL: a new search or service reloads the list from its first page. -->
		<form
			class="tools"
			method="GET"
			data-sveltekit-keepfocus
			data-sveltekit-noscroll
			data-sveltekit-replacestate
		>
			<label class="search">
				<Icon name="search" size="sm" />
				<Input
					type="search"
					name="texto"
					aria-label="Buscar por nombre o teléfono"
					placeholder="Nombre o teléfono"
					value={filters.search}
					oninput={searchSoon}
				/>
			</label>
			<div class="chip-row" role="group" aria-label="Servicio">
				<Chip
					type="radio"
					name="servicio"
					value=""
					label="Todos"
					checked={undefined === filters.service}
					onchange={apply}
				/>
				{#each Object.entries(SERVICE_LABELS) as [service, label] (service)}
					<Chip
						type="radio"
						name="servicio"
						value={service}
						{label}
						checked={service === filters.service}
						onchange={apply}
					/>
				{/each}
			</div>
		</form>

		{#if 0 === data.contacts.length}
			<div class="none">
				<p class="meta">{noneText}</p>
				<Button href={resolve('/contactos')} variant="secondary" inline>Ver todos</Button>
			</div>
		{:else}
			<ul class="contacts">
				{#each data.contacts as contact (contact.id)}
					<li class="contact">
						<a
							class="contact__open"
							href={resolve('/(app)/contactos/[id]', { id: String(contact.id) })}
						>
							<span class="contact__name">{contact.fullName}</span>
							{#if contact.isEmployee || contact.services.length}
								<span class="contact__badges">
									{#if contact.isEmployee}
										<Badge tone="info">Empleado</Badge>
									{/if}
									{#each contact.services as service (service)}
										<Badge>{SERVICE_LABELS[service]}</Badge>
									{/each}
								</span>
							{/if}
						</a>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a phone call, not a route -->
						<a
							class="contact__call"
							href="tel:+{contact.phone}"
							aria-label="Llamar a {contact.fullName} · {formatPhone(contact.phone)}"
						>
							<Icon name="phone" size="sm" />{formatPhone(contact.phone)}
						</a>
					</li>
				{/each}
			</ul>
			{#if data.hasMore}
				<div class="more">
					<Button
						href={moreHref}
						variant="secondary"
						data-sveltekit-noscroll
						data-sveltekit-replacestate
					>
						Cargar más
					</Button>
				</div>
			{:else if isFiltered}
				<p class="note">
					{data.contacts.length}
					{1 === data.contacts.length ? 'resultado' : 'resultados'}.
				</p>
			{/if}
		{/if}

		<div class="screen__action">{@render newContact()}</div>
	{/if}
</Screen>

{#snippet newContact()}
	<Button href={resolve('/contactos/nuevo')}>Nuevo contacto</Button>
{/snippet}

<style>
	p {
		margin: 0;
	}

	.saved {
		margin-bottom: var(--space-5);
	}

	.empty {
		display: grid;
		place-content: center;
		height: 100%;
		text-align: center;
	}

	.empty__action {
		margin-top: var(--space-8);
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

	.tools .chip-row {
		margin: var(--space-6) 0 var(--space-4);
	}

	.none {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		align-items: center;
		padding-top: var(--space-14);
		text-align: center;
	}

	.contacts {
		padding: 0;
		margin: 0;
		list-style: none;
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.contact {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		min-height: 64px;
		border-bottom: var(--border-w) solid var(--border-default);
	}

	/* The name opens the contact; the phone, apart, calls it. */
	.contact__open {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-2);
		align-self: stretch;
		justify-content: center;
		min-width: 0;
		padding: var(--space-4) 0;
		color: inherit;
		text-decoration: none;
	}

	.contact__name {
		overflow: hidden;
		text-overflow: ellipsis;
		font: var(--weight-semibold) var(--text-base) / 1.3 var(--font-sans);
		white-space: nowrap;
	}

	.contact__badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.contact__call {
		display: flex;
		flex: none;
		gap: var(--space-3);
		align-items: center;
		min-height: 48px;
		padding-left: var(--space-6);
		font: var(--weight-semibold) var(--text-base) / 1.2 var(--font-sans);
		font-variant-numeric: tabular-nums;
		color: var(--link);
		white-space: nowrap;
		text-decoration: none;
	}

	.more {
		margin-top: var(--space-8);
	}

	.note {
		margin-top: var(--space-6);
	}
</style>
