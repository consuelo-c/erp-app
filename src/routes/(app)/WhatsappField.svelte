<script lang="ts">
	import { resolve } from '$app/paths';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import { formatWhatsapp, normalizeWhatsapp } from '$lib/whatsapp';

	// «Usuario de WhatsApp» on the contact and employee forms: optional, shown with its `@`. Once
	// typed, it warns when another contact has it, and the save still goes through: it's no key.
	interface Props {
		/** What the field shows: the saved username with its `@`, or what was typed. */
		value: string;
		/** The contact being edited, whose own username doesn't count; null for a new one. */
		exceptId: number | null;
		label?: string;
		error?: string;
	}

	let {
		value = $bindable(),
		exceptId,
		label = 'Usuario de WhatsApp (opcional)',
		error
	}: Props = $props();

	let owner = $state<string | null>(null);

	// A valid username reads with its `@` once typed; anything not valid stays as typed.
	async function tidyAndCheck() {
		const username = normalizeWhatsapp(value);
		if (null === username) {
			owner = null;
			return;
		}
		value = formatWhatsapp(username);
		const query = new URLSearchParams({ usuario: username, contacto: String(exceptId ?? 0) });
		const response = await fetch(`${resolve('/contactos/usuario')}?${query}`);
		owner = response.ok ? ((await response.json()) as { owner: string | null }).owner : null;
	}
</script>

<Field {label} id="whatsapp" hint={owner ? warning : undefined} {error}>
	<Input
		id="whatsapp"
		name="whatsapp"
		bind:value
		placeholder="Ej. @LuzMarinaR"
		autocomplete="off"
		autocapitalize="off"
		spellcheck="false"
		onblur={tidyAndCheck}
		oninput={() => (owner = null)}
		aria-invalid={undefined !== error}
	/>
</Field>

{#snippet warning()}
	<span class="warning">Otro contacto ya tiene este usuario: {owner}.</span>
{/snippet}

<style>
	.warning {
		font-style: normal;
		font-weight: var(--weight-semibold);
		color: var(--warning-fg);
	}
</style>
