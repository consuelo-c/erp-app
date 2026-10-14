<script lang="ts">
	import { resolve } from '$app/paths';
	import IconButton from '$lib/components/IconButton.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
</script>

<svelte:head>
	<title>Banquetes Consuelo C</title>
</svelte:head>

<!-- Public landing: the logo and the way in, nothing else. The client lookup lands here later. -->
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

<style>
	.landing__entry {
		margin-left: auto;
	}

	.landing {
		display: grid;
		place-items: center;
		height: 100%;
	}

	/* Wide enough for the script logo's thin strokes to stay legible, as on the login. */
	.landing__logo {
		width: 75%;
		max-width: 300px;
	}
</style>
