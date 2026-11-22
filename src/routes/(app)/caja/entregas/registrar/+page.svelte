<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatBalance, formatPesos } from '$lib/format';
	import { parsePesos } from '$lib/payroll';
	import type { PageProps } from './$types';

	// The cash a person brings to the office. What's typed is read off the form as it changes, so the
	// confirmation shows what stays on their tab.
	let { data, form }: PageProps = $props();

	let entered = $state<FormData | null>(null);
	const typed = (name: string, initial: string) => String(entered?.get(name) ?? initial);
	const errorOf = (name: string): string | undefined => form?.errors?.[name];

	const initialUsername = $derived(
		data.people.find(({ username }) => username === data.chosen)?.username ??
			data.people[0]?.username ??
			''
	);
	const person = $derived(
		data.people.find(({ username }) => username === typed('username', initialUsername))
	);
	const amount = $derived(parsePesos(typed('amount', '')));
	const backHref = $derived(
		undefined === person
			? resolve('/(app)/caja/entregas')
			: `${resolve('/(app)/caja/entregas')}?${new URLSearchParams({ persona: person.username })}`
	);

	let isConfirmOpen = $state(false);

	// The fields are checked before asking, since the dialog covers them.
	function askToConfirm(event: MouseEvent) {
		if ((event.currentTarget as HTMLButtonElement).form?.reportValidity()) {
			isConfirmOpen = true;
		}
	}

	// A failed save keeps what was typed; the dialog closes once the server answers.
	const keepValues: SubmitFunction = () => {
		return async ({ update }) => {
			await update({ reset: false });
			isConfirmOpen = false;
		};
	};
</script>

<svelte:head>
	<title>Registrar entrega · Entregas de efectivo · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Registrar entrega" {backHref} />
	{/snippet}

	<UnsavedChangesGuard form="handover" />

	<form
		id="handover"
		method="POST"
		use:enhance={keepValues}
		oninput={(event) => (entered = new FormData(event.currentTarget))}
	>
		<div class="form-stack">
			<!-- The person whose tab the manager was reading: another one is chosen there. -->
			<Field
				label="Entregó"
				id="username_name"
				hint={person ? `Por entregar: ${formatBalance(person.pending)}` : undefined}
				error={errorOf('username')}
			>
				<input type="hidden" name="username" value={initialUsername} />
				<Input id="username_name" value={person?.name ?? ''} readonly />
			</Field>

			<div class="field-row">
				<Field label="Recibido" id="amount" error={errorOf('amount')}>
					<Input
						id="amount"
						name="amount"
						inputmode="numeric"
						placeholder="$0"
						required
						aria-invalid={undefined !== errorOf('amount')}
					/>
				</Field>
				<Field label="Fecha" id="handover_date" error={errorOf('handover_date')}>
					<Input
						id="handover_date"
						name="handover_date"
						type="date"
						value={data.today}
						required
						aria-invalid={undefined !== errorOf('handover_date')}
					/>
				</Field>
			</div>

			<Field label="Nota (opcional)" id="note">
				<Input id="note" name="note" placeholder="Ej. Viene con el sobre del #1061" />
			</Field>
		</div>

		{#if form?.message}
			<div class="handover__notice">
				<Notice tone="error">{form.message}</Notice>
			</div>
		{/if}

		<div class="screen__action">
			<Button type="button" onclick={askToConfirm}>Guardar entrega</Button>
		</div>
	</form>

	<Modal
		bind:open={isConfirmOpen}
		title="Confirmar entrega"
		body="La entrega no cambia la caja ni lleva número de recibo."
	>
		<ul class="detail-list">
			<li class="detail-list__row--plain"><span>Entregó</span><span>{person?.name}</span></li>
			<li><span>Recibido</span><span>{formatPesos(amount)}</span></li>
			<li class="detail-list__row--plain">
				<span>Queda por entregar</span><span>{formatBalance((person?.pending ?? 0) - amount)}</span>
			</li>
		</ul>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isConfirmOpen = false)}>
				Cancelar
			</Button>
			<Button type="submit" form="handover" size="md">Confirmar</Button>
		{/snippet}
	</Modal>
</Screen>

<style>
	.field-row {
		display: flex;
		gap: var(--control-gap);
	}

	.handover__notice {
		margin-top: var(--space-8);
	}
</style>
