<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Facts from '../Facts.svelte';
	import RolesField from '../RolesField.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const login = $derived(data.login);
	const id = $derived(String(login.id));

	let deactivateOpen = $state(false);

	// The dialog closes once the server answers; an error shows above the roles.
	const closeDialog: SubmitFunction = () => {
		return async ({ update }) => {
			await update();
			deactivateOpen = false;
		};
	};
</script>

<svelte:head>
	<title>{login.username} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title={login.username} backHref={resolve('/logins')} />
	{/snippet}

	<UnsavedChangesGuard form="roles" />

	<Facts
		rows={[
			['Estado', login.isActive ? 'Activo' : 'Inactivo'],
			['Empleado', login.employee?.fullName ?? 'Sin empleado']
		]}
	/>

	<!-- After a failed save the chips come back as they were chosen. Every submit button sits
	     outside its form (end of the body, the dialog) and reaches it through its `form` attribute. -->
	<form id="roles" class="form-stack" method="POST" action="?/roles" use:enhance>
		{#if form?.message}
			<Notice tone="error">{form.message}</Notice>
		{/if}
		<RolesField chosen={form?.roles ?? login.roles} />
	</form>

	<form id="deactivate" method="POST" action="?/deactivate" use:enhance={closeDialog} hidden></form>
	<form id="reactivate" method="POST" action="?/reactivate" use:enhance hidden></form>
	<Modal
		bind:open={deactivateOpen}
		title="¿Desactivar el login {login.username}?"
		body="Nadie podrá entrar con este usuario. El login no se elimina."
	>
		{#snippet actions()}
			<Button type="button" variant="secondary" onclick={() => (deactivateOpen = false)}>
				Cancelar
			</Button>
			<Button type="submit" form="deactivate">Desactivar</Button>
		{/snippet}
	</Modal>

	<div class="screen__action">
		<Button variant="secondary" href={resolve('/(app)/logins/[id]/contrasena', { id })}>
			Cambiar contraseña
		</Button>
		<Button variant="secondary" href={resolve('/(app)/logins/[id]/reasignar', { id })}>
			Reasignar a otro empleado
		</Button>
		{#if login.isActive}
			<Button type="button" variant="secondary" onclick={() => (deactivateOpen = true)}>
				Desactivar
			</Button>
		{:else}
			<!-- Nothing is lost by reactivating, so it doesn't ask first. -->
			<Button type="submit" variant="secondary" form="reactivate">Reactivar</Button>
		{/if}
		<Button type="submit" form="roles">Guardar cambios</Button>
	</div>
	<p class="note">Los logins no se eliminan. Desactívalo para bloquear la entrada.</p>
</Screen>
