<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head>
	<title>Entrar · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader backHref={resolve('/')} />
	{/snippet}

	<!-- Exactly two fields and a button: no signup, no password recovery. -->
	<form class="login form-stack" method="POST" use:enhance>
		<img class="login__logo" src="/banquetes-consuelo-c-logo.svg" alt="Banquetes Consuelo C" />
		<Field label="Usuario" id="username">
			<Input
				id="username"
				name="username"
				value={form?.username ?? ''}
				placeholder="Tu usuario"
				autocomplete="username"
				autocapitalize="none"
				required
				aria-invalid={form?.invalid}
			/>
		</Field>
		<Field label="Contraseña" id="password">
			<Input
				id="password"
				name="password"
				type="password"
				placeholder="Tu contraseña"
				autocomplete="current-password"
				required
				aria-invalid={form?.invalid}
			/>
		</Field>
		{#if form?.invalid}
			<Notice tone="error">Usuario o contraseña incorrectos</Notice>
		{/if}
		<Button type="submit">Entrar</Button>
	</form>
</Screen>

<style>
	.login {
		max-width: 400px;
		margin: 0 auto;
	}

	/* The form is already narrow: its button keeps the fields' width, as on a phone. */
	.login :global(.btn) {
		max-width: none;
	}

	/* Wide enough for the script logo's thin strokes to stay legible. */
	.login__logo {
		width: 75%;
		margin: calc(3 * var(--space-14)) auto var(--space-12);
	}
</style>
