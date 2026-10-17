<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import Facts from '../../Facts.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Cambiar contraseña · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader
			title="Cambiar contraseña"
			backHref={resolve('/(app)/logins/[id]', { id: String(data.login.id) })}
		/>
	{/snippet}

	<UnsavedChangesGuard form="password" />

	<Facts rows={[['Login', data.login.username]]} />

	<!-- The submit button sits after the form and reaches this form through its `form` attribute. -->
	<form id="password" class="form-stack" method="POST" use:enhance>
		{#if form?.message}
			<Notice tone="error">{form.message}</Notice>
		{/if}
		<Field
			label="Nueva contraseña"
			id="password_input"
			hint="Entrégasela a la persona directamente."
		>
			<Input
				id="password_input"
				name="password"
				type="password"
				autocomplete="new-password"
				minlength={8}
				required
			/>
		</Field>
	</form>

	<div class="screen__action">
		<Button type="submit" form="password">Guardar contraseña</Button>
	</div>
</Screen>
