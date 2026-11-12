<script lang="ts">
	import IconButton from '$lib/components/IconButton.svelte';
	import { formatPhone } from '$lib/phone';
	import { formatWhatsapp, whatsappUsernameHref } from '$lib/whatsapp';

	// A client's or a contact's phone and WhatsApp username, each on its own line with its own icons,
	// each icon naming the value it opens: the number calls and writes to the number, the username
	// writes to the username. A missing value shows nothing; with neither, nothing at all.
	interface Props {
		phone: string | null;
		whatsapp: string | null;
	}

	let { phone, whatsapp }: Props = $props();
</script>

{#if phone || whatsapp}
	<div class="reach-lines">
		{#if phone}
			{@const number = formatPhone(phone)}
			<div class="reach-lines__line">
				<span class="reach-lines__value">{number}</span>
				<IconButton icon="phone" size="lg" label="Llamar al {number}" href="tel:+{phone}" />
				<IconButton
					icon="whatsapp"
					size="lg"
					label="Escribir por WhatsApp al {number}"
					href="https://wa.me/{phone}"
					target="_blank"
					rel="noopener"
				/>
			</div>
		{/if}
		{#if whatsapp}
			{@const username = formatWhatsapp(whatsapp)}
			<div class="reach-lines__line">
				<span class="reach-lines__value">{username}</span>
				<IconButton
					icon="whatsapp"
					size="lg"
					label="Escribir por WhatsApp a {username}"
					href={whatsappUsernameHref(whatsapp)}
					target="_blank"
					rel="noopener"
				/>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* 22px between lines: each icon's 48px hit area overhangs its 26px glyph by 11px above and below. */
	.reach-lines {
		display: flex;
		flex-direction: column;
		gap: var(--space-11);
	}

	/* 24px apart: each icon's 48px hit area overhangs its glyph by 11px on either side. */
	.reach-lines__line {
		display: flex;
		gap: var(--space-12);
		align-items: center;
		color: var(--link);
	}

	.reach-lines__value {
		color: var(--text-body);
	}
</style>
