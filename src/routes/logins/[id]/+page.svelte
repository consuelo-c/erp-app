<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import LogoutButton from '$lib/components/LogoutButton.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import RolesField from '../RolesField.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const login = $derived(data.login);
</script>

<svelte:head>
	<title>{login.username} · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title={login.username} backHref={resolve('/logins')}>
			<LogoutButton />
		</ScreenHeader>
	{/snippet}

	<UnsavedChangesGuard form="roles" />

	<dl class="facts">
		<div class="facts__row">
			<dt>Estado</dt>
			<dd>{login.isActive ? 'Activo' : 'Inactivo'}</dd>
		</div>
		<div class="facts__row">
			<dt>Empleado</dt>
			<dd>{login.employee?.fullName ?? 'Sin empleado'}</dd>
		</div>
	</dl>

	<!-- After a failed save the chips come back as they were chosen. The submit button sits at the
	     end of the body and reaches this form through its `form` attribute. -->
	<form id="roles" class="form-stack" method="POST" action="?/roles" use:enhance>
		{#if form?.message}
			<Notice tone="error">{form.message}</Notice>
		{/if}
		<RolesField chosen={form?.roles ?? login.roles} />
	</form>

	<div class="screen__action">
		<Button type="submit" form="roles">Guardar cambios</Button>
	</div>
</Screen>

<style>
	.facts {
		margin: 0 0 var(--field-gap);
	}

	.facts__row {
		display: flex;
		justify-content: space-between;
		padding: var(--space-4) 0;
	}

	.facts dt {
		color: var(--text-secondary);
	}

	.facts dd {
		margin: 0;
		font-weight: var(--weight-semibold);
	}
</style>
