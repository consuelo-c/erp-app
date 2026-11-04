<script lang="ts">
	import { resolve } from '$app/paths';
	import Choice from '$lib/components/Choice.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import { formatPhone } from '$lib/phone';
	import type { ClientCandidate } from '$lib/server/services/contacts';
	import { moveThroughResults } from './order-form';

	// «Cliente»: the contacts matching what's typed, as cards to pick, and «Cliente nuevo». The order
	// form and the quote form share it; what picking fills in (phone, name, address) is the form's.
	interface Props {
		/** The contact picked, «Cliente nuevo», or nobody yet. */
		choice: number | 'new' | null;
		/** The client picked, listed on top while another search is typed; on an edit, the saved one. */
		picked: ClientCandidate | null;
		onpick: (candidate: ClientCandidate) => void;
		onnew: () => void;
		error?: string;
	}

	let { choice = $bindable(), picked = $bindable(), onpick, onnew, error }: Props = $props();

	const SEARCH_ID = 'client-search';

	let query = $state('');
	let candidates = $state<ClientCandidate[]>([]);
	let clientList: HTMLElement | undefined = $state();

	const clientOptions = $derived.by(() => {
		const own = 'new' === choice ? null : picked;
		if (null === own || candidates.some((candidate) => own.id === candidate.id)) {
			return candidates;
		}
		return [own, ...candidates];
	});

	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	// The contacts matching what's typed, by name, phone or address, once the typing pauses.
	function searchClients() {
		clearTimeout(searchTimer);
		const typed = query.trim();
		if ('' === typed) {
			candidates = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			const params = new URLSearchParams({ texto: typed });
			const response = await fetch(`${resolve('/pedidos/clientes')}?${params}`);
			if (response.ok && typed === query.trim()) {
				candidates = await response.json();
			}
		}, 300);
	}

	function pick(candidate: ClientCandidate) {
		choice = candidate.id;
		picked = candidate;
		onpick(candidate);
	}

	function pickNew() {
		choice = 'new';
		onnew();
	}

	function clientRadios(): Iterable<HTMLInputElement> {
		return clientList?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [];
	}

	// Enter would submit the form: it picks the first contact found instead. Down goes to the cards.
	function keyInSearch(event: KeyboardEvent) {
		if ('Enter' !== event.key) {
			moveThroughResults(event, event.currentTarget as HTMLElement, clientRadios());
			return;
		}
		event.preventDefault();
		if (candidates.length) {
			pick(candidates[0]);
		}
	}

	// The arrows only move the focus between the cards; Enter picks the focused one.
	function keyInCards(event: KeyboardEvent) {
		if ('Enter' === event.key) {
			event.preventDefault();
			(event.target as HTMLElement).click();
			return;
		}
		moveThroughResults(event, document.getElementById(SEARCH_ID), clientRadios());
	}

	function addressOf(candidate: ClientCandidate): string {
		return [candidate.address1, candidate.address2].filter(Boolean).join(', ');
	}
</script>

<Field label="Buscar cliente" id={SEARCH_ID}>
	<Input
		id={SEARCH_ID}
		type="search"
		autocomplete="off"
		placeholder="Buscar por nombre, teléfono o dirección"
		bind:value={query}
		oninput={searchClients}
		onkeydown={keyInSearch}
	/>
</Field>

<!-- With nothing searched, only the client picked, if any, and «Cliente nuevo». -->
<Choice aria-label="Escoge el cliente" layout="none">
	<div class="clients__list" bind:this={clientList}>
		{#each clientOptions as candidate (candidate.id)}
			<label class="client">
				<input
					type="radio"
					name="client"
					checked={candidate.id === choice}
					onchange={() => pick(candidate)}
					onkeydown={keyInCards}
				/>
				<span class="client__text">
					<span class="client__name">{candidate.fullName}</span>
					<span class="meta">{formatPhone(candidate.phone)}</span>
					{#if candidate.address1}
						<span class="meta">{addressOf(candidate)}</span>
					{/if}
				</span>
			</label>
		{/each}
		<label class="client">
			<input
				type="radio"
				name="client"
				checked={'new' === choice}
				onchange={pickNew}
				onkeydown={keyInCards}
			/>
			<span class="client__text">
				<span class="client__name">Cliente nuevo</span>
				<span class="meta">Con el teléfono y el nombre que escribas</span>
			</span>
		</label>
	</div>
	{#if error}
		<p class="field-error">{error}</p>
	{/if}
</Choice>

<style>
	.field-error {
		margin: var(--space-3) 0 0;
		font-size: var(--text-xs);
		color: var(--error-fg);
	}
</style>
