<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Field from '$lib/components/Field.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import { formatInstant } from '$lib/datetime';
	import {
		INCIDENT_OUTCOME_LABELS,
		INCIDENT_STATUS_LABELS,
		RESPONSIBLE_PARTY_LABELS
	} from '$lib/labels';
	import type { Incident } from '$lib/server/services/incidents';

	// An order's «Novedades», the same on the order's detail and in Despachos: every role reads them
	// all, and each card offers only what the service says the actor may do with it. Reversing posts
	// to the page's `?/revertir`; `onassign`, where given, opens the page's own responsible-party
	// dialog.
	interface Props {
		incidents: Incident[];
		reverseMessage?: string;
		buttonSize?: 'sm';
		onassign?: (incident: Incident) => void;
	}

	let { incidents, reverseMessage, buttonSize, onassign }: Props = $props();

	let selected = $state<Incident | null>(null);
	let isReverseOpen = $state(false);
	let reversalReason = $state('');
	const givenBack = $derived(
		selected?.items.filter((item) => 'RECOVERABLE' !== item.outcome) ?? []
	);

	function startReverse(incident: Incident) {
		selected = incident;
		reversalReason = '';
		isReverseOpen = true;
	}

	function reporterLine(incident: Incident): string {
		return incident.isReportedByActor ? 'Reportaste tú' : `Reportó ${incident.reportedBy}`;
	}

	// The reporter who lost their rights to it, so they know why there's nothing to press.
	function isFrozenForReporter(incident: Incident): boolean {
		return incident.isReportedByActor && incident.isFrozen && !incident.canReverse;
	}

	// A refusal keeps the dialog open with its message.
	const closeOnSuccess: SubmitFunction = () => {
		return async ({ result, update }) => {
			if ('success' === result.type) {
				isReverseOpen = false;
			}
			await update({ reset: false });
		};
	};
</script>

{#each incidents as incident (incident.id)}
	<Card dimmed={null !== incident.reversal}>
		{#snippet head()}
			<span>Reportada el {formatInstant(incident.reportedAt)}</span>
			<Badge tone={'ACTIVE' === incident.status ? 'error' : undefined}>
				{INCIDENT_STATUS_LABELS[incident.status]}
			</Badge>
		{/snippet}
		<p class="meta incident__reporter">
			{reporterLine(incident)} · Responsable: {RESPONSIBLE_PARTY_LABELS[incident.responsibleParty]}
		</p>
		<ul class="detail-list">
			{#each incident.items as item (`${item.product_id}:${item.outcome}`)}
				<li class="detail-list__row--plain">
					<span>{item.qty} × {item.name}</span>
					<span>{INCIDENT_OUTCOME_LABELS[item.outcome]}</span>
				</li>
			{/each}
		</ul>
		<p class="incident__description">{incident.description}</p>
		{#if incident.reversal}
			<p class="note">
				Revertida el {formatInstant(incident.reversal.reversedAt)} por {incident.reversal
					.reversedBy}: {incident.reversal.reason}
			</p>
		{:else}
			<!-- An open item for the office: whose fault it was decides whether the deposit is withheld. -->
			{#if incident.canSetResponsibleParty && 'UNDETERMINED' === incident.responsibleParty}
				<Notice tone="warning">
					Falta definir el responsable: si no fue el cliente, el depósito no se retiene.
				</Notice>
			{/if}
			{#if isFrozenForReporter(incident)}
				<p class="note">El Gerente ya le puso responsable: no se puede corregir.</p>
			{/if}
			<!-- STUB: #619 adds «Corregir» here when `incident.canCorrect`. -->
			{#if (onassign && incident.canSetResponsibleParty) || (incident.canReverse && null === incident.reversalBlock)}
				<div class="incident__actions">
					{#if onassign && incident.canSetResponsibleParty}
						<Button variant="secondary" size={buttonSize} onclick={() => onassign(incident)}>
							Cambiar responsable
						</Button>
					{/if}
					{#if incident.canReverse && null === incident.reversalBlock}
						<Button variant="secondary" size={buttonSize} onclick={() => startReverse(incident)}>
							Revertir
						</Button>
					{/if}
				</div>
			{/if}
			{#if incident.canReverse && incident.reversalBlock}
				<p class="note">No se puede revertir: {incident.reversalBlock}.</p>
			{/if}
		{/if}
	</Card>
{/each}

{#if selected}
	{@const incident = selected}
	<Modal
		bind:open={isReverseOpen}
		title="¿Revertir la novedad?"
		body={0 < givenBack.length
			? 'Devuelve al inventario:'
			: 'El inventario no cambia: todo era recuperable.'}
	>
		<form
			id="reverse"
			class="form-stack"
			method="POST"
			action="?/revertir"
			use:enhance={closeOnSuccess}
		>
			{#if givenBack.length}
				<ul class="given-back">
					{#each givenBack as item (`${item.product_id}:${item.outcome}`)}
						<li>{item.qty} × {item.name} · {INCIDENT_OUTCOME_LABELS[item.outcome]}</li>
					{/each}
				</ul>
			{/if}
			<input type="hidden" name="id" value={incident.id} />
			<Field label="Motivo" id="reverse-reason" error={reverseMessage}>
				<textarea
					class="reason"
					id="reverse-reason"
					name="reason"
					rows="3"
					placeholder="Ej. Las sillas aparecieron en la bodega"
					aria-invalid={reverseMessage ? 'true' : undefined}
					required
					bind:value={reversalReason}></textarea>
			</Field>
		</form>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isReverseOpen = false)}>
				Volver
			</Button>
			<Button type="submit" form="reverse" size="md" disabled={'' === reversalReason.trim()}>
				Revertir
			</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	p {
		margin: 0;
	}

	.incident__reporter {
		margin-bottom: var(--space-4);
	}

	.incident__description {
		margin: var(--space-4) 0;
		font-size: var(--text-base);
		line-height: 1.4;
	}

	.incident__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin-top: var(--space-4);
	}

	.given-back {
		padding-left: var(--space-8);
		margin: 0;
	}

	.reason {
		box-sizing: border-box;
		width: 100%;
		padding: var(--space-6) var(--space-7);
		margin: 0;
		font: var(--type-input);
		color: var(--text-body);
		resize: vertical;
		outline: none;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-input);
	}

	.reason:focus-visible {
		border-color: var(--border-strong);
	}
</style>
