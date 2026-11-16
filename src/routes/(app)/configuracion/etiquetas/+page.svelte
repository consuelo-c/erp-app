<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { BANNED } from '$lib/contact-labels';
	import type { LabelRow } from '$lib/server/services/contacts';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// One form open at a time: «Nueva etiqueta», or one row's new name.
	let adding = $state(false);
	let renaming = $state<string | null>(null);
	let draft = $state('');
	let deleting = $state<LabelRow | null>(null);
	let isDeleteOpen = $state(false);

	const countText = (count: number) => {
		if (0 === count) {
			return 'Ningún contacto';
		}
		return 1 === count ? '1 contacto' : `${count} contactos`;
	};

	const errorOf = (action: string) => (action === form?.action ? form.message : undefined);

	function close() {
		adding = false;
		renaming = null;
		draft = '';
	}

	function startAdding() {
		close();
		adding = true;
	}

	function startRenaming(label: LabelRow) {
		close();
		renaming = label.key;
		draft = label.name;
	}

	function startDeleting(label: LabelRow) {
		close();
		deleting = label;
		isDeleteOpen = true;
	}

	// A saved change closes its form and the reloaded list shows it; a refusal keeps what was typed.
	const submit: SubmitFunction = () => {
		return async ({ result, update }) => {
			if ('success' === result.type) {
				close();
				isDeleteOpen = false;
			}
			await update({ reset: false });
		};
	};
</script>

<svelte:head>
	<title>Etiquetas · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Etiquetas" />
	{/snippet}

	<UnsavedChangesGuard form="label" />

	<p class="meta labels__intro">
		Marcan a los contactos: proveedores, empleados y clientes. Transportador y Vetado no se
		eliminan.
	</p>

	{#if adding}
		<form
			id="label"
			class="labels__form labels__form--new"
			method="POST"
			action="?/crear"
			novalidate
			use:enhance={submit}
		>
			<Field label="Nueva etiqueta" id="new-label" error={errorOf('crear')}>
				<Input
					id="new-label"
					name="name"
					placeholder="Ej. Proveedor de carpas"
					bind:value={draft}
					aria-invalid={undefined !== errorOf('crear')}
				/>
			</Field>
			<div class="labels__buttons">
				<Button type="button" variant="secondary" size="md" onclick={close}>Cancelar</Button>
				<Button type="submit" size="md">Agregar</Button>
			</div>
		</form>
	{/if}

	<ul class="labels__rows">
		{#each data.labels as label (label.key)}
			<li class="labels__row">
				{#if renaming === label.key}
					<form
						id="label"
						class="labels__form"
						method="POST"
						action="?/renombrar"
						novalidate
						use:enhance={submit}
					>
						<input type="hidden" name="key" value={label.key} />
						<Field
							label="Nombre de la etiqueta"
							id="label-name"
							hint="{countText(label.contactCount)}: verán el nombre nuevo."
							error={errorOf('renombrar')}
						>
							<Input
								id="label-name"
								name="name"
								bind:value={draft}
								aria-invalid={undefined !== errorOf('renombrar')}
							/>
						</Field>
						<div class="labels__buttons">
							<Button type="button" variant="secondary" size="md" onclick={close}>Cancelar</Button>
							<Button type="submit" size="md">Guardar</Button>
						</div>
					</form>
				{:else}
					<span class="labels__label">
						<span class="labels__name" class:labels__name--danger={BANNED === label.key}>
							{label.name}
						</span>
						<span class="meta">{countText(label.contactCount)}</span>
					</span>
					<span class="labels__edit">
						<IconButton
							icon="edit"
							label="Cambiar el nombre de {label.name}"
							onclick={() => startRenaming(label)}
						/>
					</span>
					{#if label.isBuiltIn}
						<span class="labels__spacer"></span>
					{:else}
						<span class="labels__delete">
							<IconButton
								icon="trash"
								label="Eliminar {label.name}"
								onclick={() => startDeleting(label)}
							/>
						</span>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>

	<p class="note labels__note">Cada cambio queda registrado con tu usuario.</p>
	{#if !adding}
		<div class="screen__action">
			<Button type="button" onclick={startAdding}>Nueva etiqueta</Button>
		</div>
	{/if}
</Screen>

{#if deleting}
	<Modal
		bind:open={isDeleteOpen}
		title="¿Eliminar {deleting.name}?"
		body={0 === deleting.contactCount
			? ''
			: `${deleting.name} está en ${countText(deleting.contactCount)}; se quita de todos.`}
	>
		{#if errorOf('eliminar')}
			<Notice tone="error">{errorOf('eliminar')}</Notice>
		{/if}
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (isDeleteOpen = false)}>
				Cancelar
			</Button>
			<form class="labels__delete-form" method="POST" action="?/eliminar" use:enhance={submit}>
				<input type="hidden" name="key" value={deleting?.key} />
				<Button type="submit" size="md">Eliminar</Button>
			</form>
		{/snippet}
	</Modal>
{/if}

<style>
	.labels__intro {
		margin: 0 0 var(--space-8);
	}

	.labels__rows {
		padding: 0;
		margin: 0;
		list-style: none;
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.labels__row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		min-height: 60px;
		border-bottom: var(--border-w-hair) solid var(--border-default);
	}

	.labels__label {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		padding-block: var(--space-4);
	}

	.labels__name {
		font-weight: var(--weight-semibold);
	}

	.labels__name--danger {
		color: var(--error-fg);
	}

	.labels__edit {
		color: var(--link);
	}

	.labels__delete {
		color: var(--error-fg);
	}

	/* Holds the trash's place on the built-in rows, so every pencil lines up. */
	.labels__spacer {
		flex: none;
		width: 44px;
	}

	.labels__form {
		flex: 1;
		padding-block: var(--space-6) var(--space-8);
	}

	.labels__form--new {
		border-top: var(--border-w-strong) solid var(--border-strong);
	}

	.labels__buttons {
		display: flex;
		gap: var(--space-5);
		margin-top: var(--space-6);
	}

	.labels__buttons > :global(*) {
		flex: 1;
	}

	.labels__note {
		margin-top: var(--space-6);
	}

	.labels__delete-form {
		display: contents;
	}
</style>
