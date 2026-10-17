<script lang="ts">
	import { resolve } from '$app/paths';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { ROLE_LABELS } from '$lib/labels';
	import { PERSONAL_TABS } from '$lib/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The admin's own login is always there: the empty state is "no other logins yet".
	const isOnlyOwnLogin = $derived(data.logins.length <= 1);
</script>

<svelte:head>
	<title>Logins · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader><Tabs tabs={PERSONAL_TABS} current="Logins" /></ScreenHeader>
	{/snippet}

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
