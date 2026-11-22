<script lang="ts">
	import { resolve } from '$app/paths';
	import IconButton from '$lib/components/IconButton.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import WhatsAppButton from '$lib/components/WhatsAppButton.svelte';
	import type { PageProps } from './$types';

	// The public landing: the logo, the employees' way in and the company's WhatsApp. A client
	// reaches their order only through the link the company sends.
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader>
			<span class="landing__entry">
				<IconButton href={resolve('/login')} icon="login" label="Empleados" />
			</span>
		</ScreenHeader>
	{/snippet}

	<div class="landing">
		<img class="landing__logo" src="/banquetes-consuelo-c-logo.svg" alt="Banquetes Consuelo C" />
	</div>
</Screen>

<WhatsAppButton href={data.whatsAppHref} />

<style>
	.landing__entry {
		margin-left: auto;
	}

	.landing {
		max-width: 420px;
		margin: 0 auto;
	}

	/* Wide enough for the script logo's thin strokes to stay legible, as on the login. */
	.landing__logo {
		display: block;
		width: 75%;
		max-width: 240px;
		margin: var(--space-14) auto 36px;
	}

	@container (width >= 1024px) {
		.landing__logo {
			width: 280px;
			max-width: none;
			margin-top: var(--space-14);
		}
	}
</style>
