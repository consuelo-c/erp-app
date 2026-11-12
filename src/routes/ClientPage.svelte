<script lang="ts">
	import type { Snippet } from 'svelte';
	import WhatsAppButton from '$lib/components/WhatsAppButton.svelte';

	// The client's side, read on their own phone: no shell and no navigation, the logo at the top
	// and the company's WhatsApp, around «Su pedido», «Su cotización» or «ya no está disponible».
	let { whatsAppHref, children }: { whatsAppHref: string | null; children: Snippet } = $props();
</script>

<main class="client-page">
	<img class="client-page__logo" src="/banquetes-consuelo-c-logo.svg" alt="Banquetes Consuelo C" />
	{@render children()}
</main>

{#if whatsAppHref}
	<WhatsAppButton href={whatsAppHref} />
{/if}

<style>
	/* The bottom padding keeps the last total clear of the WhatsApp button. */
	.client-page {
		box-sizing: border-box;
		max-width: 640px;
		padding: var(--screen-header-top) var(--screen-pad-x) 124px;
		margin: 0 auto;
	}

	.client-page__logo {
		display: block;
		width: 180px;
		margin: 0 auto;
	}

	@container (width >= 1024px) {
		.client-page {
			padding-top: 64px;
		}

		.client-page__logo {
			width: 220px;
		}
	}
</style>
