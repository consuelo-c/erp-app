<script lang="ts">
	import { resolve } from '$app/paths';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Select from '$lib/components/Select.svelte';
	import CashStatementView from '../../efectivo/CashStatementView.svelte';
	import type { PageProps } from './$types';

	// «Efectivo por entregar» as the manager reads it: anyone's, chosen with «Persona», and where
	// the cash they bring in is recorded.
	let { data }: PageProps = $props();

	function submitOnChange(event: Event & { currentTarget: HTMLFormElement }) {
		event.currentTarget.requestSubmit();
	}
</script>

<svelte:head>
	<title>Entregas de efectivo · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Entregas de efectivo" />
	{/snippet}

	{#if null === data.person || null === data.statement}
		<p class="meta">Nadie tiene efectivo por entregar.</p>
	{:else}
		<form method="get" class="handovers__person" onchange={submitOnChange}>
			<Field label="Persona" id="persona">
				<Select id="persona" name="persona" value={data.person.username}>
					{#each data.people as person (person.username)}
						<option value={person.username}>{person.name}</option>
					{/each}
				</Select>
			</Field>
		</form>

		<CashStatementView statement={data.statement} username={data.person.username}>
			{#snippet status()}
				{#if 0 === data.statement?.pending}
					<Badge tone="completed">Al día</Badge>
				{/if}
			{/snippet}
		</CashStatementView>

		<div class="screen__action">
			<Button
				variant="secondary"
				href="{resolve('/(app)/caja/entregas/registrar')}?{new URLSearchParams({
					persona: data.person.username
				})}"
			>
				Registrar entrega
			</Button>
		</div>
	{/if}
</Screen>

<style>
	.handovers__person {
		margin-bottom: var(--space-8);
	}
</style>
