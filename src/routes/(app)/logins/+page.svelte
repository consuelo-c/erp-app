<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { ROLE_LABELS } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The admin's own login is always there: the empty state is "no other logins yet".
	const isOnlyOwnLogin = $derived(data.logins.length <= 1);

	// Each action that saves a login comes back here with `?aviso=` naming what it did.
	const NOTICES: Record<string, string | undefined> = {
		creado: 'Login creado con éxito',
		actualizado: 'Login actualizado con éxito',
		contrasena: 'Contraseña restablecida con éxito',
		reasignado: 'Login reasignado con éxito',
		desactivado: 'Login desactivado con éxito',
		reactivado: 'Login reactivado con éxito'
	};
	const notice = $derived(NOTICES[page.url.searchParams.get('aviso') ?? '']);
</script>

<svelte:head>
	<title>Logins · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Logins" />
	{/snippet}

	{#if notice}
		<div class="saved"><Notice tone="success">{notice}</Notice></div>
	{/if}

	{#if isOnlyOwnLogin}
		<!-- Empty state: the action sits centered under the message. -->
		<div class="empty">
			<p><strong>Aún no hay más logins</strong></p>
			<p class="meta">Crea uno con Nuevo login.</p>
			<div class="empty__action">{@render newLogin()}</div>
		</div>
	{:else}
		{#each data.logins as login (login.id)}
			<Card href={resolve('/(app)/logins/[id]', { id: String(login.id) })} dimmed={!login.isActive}>
				{#snippet head()}
					<strong>{login.username}</strong>
					{#if login.isActive}
						<Badge tone="success">Activo</Badge>
					{:else}
						<Badge>Inactivo</Badge>
					{/if}
				{/snippet}
				<p class="meta">{login.roles.map((role) => ROLE_LABELS[role]).join(' · ')}</p>
				<p>{login.employee?.fullName ?? 'Sin empleado'}</p>
			</Card>
		{/each}
		<div class="screen__action">{@render newLogin()}</div>
	{/if}
</Screen>

{#snippet newLogin()}
	<Button href={resolve('/logins/nuevo')}>Nuevo login</Button>
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
</style>
