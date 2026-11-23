<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Select from '$lib/components/Select.svelte';
	import { BANNED, contactBadges, EMPLOYEE_FILTER, noMatchText } from '$lib/contact-labels';
	import ReachLines from '../ReachLines.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const filters = $derived(data.filters);
	const isFiltered = $derived('' !== filters.search || undefined !== filters.label);
	// No contact at all, as opposed to none matching: the search has nothing to narrow.
	const isEmpty = $derived(!isFiltered && 0 === data.contacts.length);

	const filterOptions = $derived([{ key: EMPLOYEE_FILTER, name: 'Empleado' }, ...data.labels]);
	const noneText = $derived(
		noMatchText(
			filters.search,
			filterOptions.find(({ key }) => key === filters.label)
		)
	);
	const countLabel = $derived.by(() => {
		const count = `${data.total} ${1 === data.total ? 'contacto' : 'contactos'}`;
		return 1 < data.pageCount ? `${count} · página ${filters.page} de ${data.pageCount}` : count;
	});

	// Another page of the same filters, as in Pedidos.
	function pageHref(pageNumber: number): string {
		const kept = [...page.url.searchParams].filter(([name]) => 'pagina' !== name);
		const turned = 1 === pageNumber ? [] : [['pagina', String(pageNumber)]];
		return `?${new URLSearchParams([...kept, ...turned])}`;
	}

	let typing: ReturnType<typeof setTimeout> | undefined;

	// The list narrows as it's typed, once the typing pauses; an etiqueta applies when picked.
	function searchSoon(event: Event & { currentTarget: HTMLInputElement }) {
		const { form } = event.currentTarget;
		clearTimeout(typing);
		typing = setTimeout(() => form?.requestSubmit(), 300);
	}

	function apply(event: Event & { currentTarget: HTMLSelectElement }) {
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
		<!-- Each filter is in the URL: a new search or etiqueta reloads the list from its first page. -->
		<form
			class="tools"
			method="GET"
			data-sveltekit-keepfocus
			data-sveltekit-noscroll
			data-sveltekit-replacestate
		>
			<label class="search">
				<Icon name="search" />
				<Input
					type="search"
					name="texto"
					aria-label="Buscar por nombre, teléfono o usuario de WhatsApp"
					placeholder="Nombre, teléfono o usuario (WA)"
					value={filters.search}
					oninput={searchSoon}
				/>
			</label>
			<div class="filter">
				<Field label="Etiqueta" id="etiqueta">
					<Select id="etiqueta" name="etiqueta" value={filters.label ?? ''} onchange={apply}>
						<option value="">Todas</option>
						{#each filterOptions as { key, name } (key)}
							<option value={key} class:banned={BANNED === key}>{name}</option>
						{/each}
					</Select>
				</Field>
			</div>
		</form>

		{#if 0 === data.contacts.length}
			<div class="none">
				<p class="meta">{noneText}</p>
				<Button href="{resolve('/contactos')}?limpiar" variant="secondary" inline>Ver todos</Button>
			</div>
		{:else}
			<ul class="contacts">
				{#each data.contacts as contact (contact.id)}
					{@const { badges, more } = contactBadges(contact, data.labels)}
					<li class="contact">
						<a
							class="contact__open"
							href={resolve('/(app)/contactos/[id]', { id: String(contact.id) })}
						>
							<span class="contact__name">{contact.fullName}</span>
							{#if 0 < badges.length}
								<span class="contact__badges">
									{#each badges as { text, tone }, i (i)}
										<Badge {tone}>{text}</Badge>
									{/each}
									{#if 0 < more}
										<span class="meta">+{more}</span>
									{/if}
								</span>
							{/if}
						</a>
						<!-- The number and the username, each with its own icons. Neither, no icons. -->
						{#if contact.phone || contact.whatsapp}
							<div class="contact__reach">
								<ReachLines phone={contact.phone} whatsapp={contact.whatsapp} />
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="note">{countLabel}</p>
			<div class="pages">
				<Pagination current={filters.page} count={data.pageCount} href={pageHref} />
			</div>
		{/if}

		<div class="screen__action">{@render newContact()}</div>
	{/if}
</Screen>

{#snippet newContact()}
	<Button href={resolve('/contactos/nuevo')}>Nuevo contacto</Button>
{/snippet}

<style>
	/* Vetado stands out among the etiquetas; a native list may ignore it (macOS, phones). */
	.banned {
		font-weight: var(--weight-bold);
	}

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

	.filter {
		margin: var(--space-6) 0 var(--space-4);
	}

	/* On a wide screen the search and the etiqueta share one row: the search takes the rest. */
	@container (width >= 1024px) {
		.tools {
			display: flex;
			gap: var(--space-4);
			align-items: flex-end;
		}

		.search {
			flex: 1 1 auto;
		}

		.filter {
			flex: 0 0 16rem;
			margin: 0;
		}
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

	/* The name opens the contact; the icons, apart, call it or write to it. */
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
		align-items: center;
	}

	.contact__reach {
		flex: none;
		padding: var(--space-4) var(--space-6);
	}

	.contact__reach :global(.reach-lines__value) {
		font: var(--weight-semibold) var(--text-base) / 1.2 var(--font-sans);
		font-variant-numeric: tabular-nums;
		color: var(--text-body);
		white-space: nowrap;
	}

	.pages {
		margin-top: var(--space-8);
	}

	.note {
		margin-top: var(--space-6);
	}
</style>
