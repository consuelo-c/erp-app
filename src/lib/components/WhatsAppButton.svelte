<script lang="ts">
	import Icon from './Icon.svelte';

	// The public pages' only contact, fixed to the bottom right, with no text beside its glyph.
	// The caller builds `href`, the `wa.me` link with its message.
	let { href }: { href: string } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an outside link -->
<a class="whatsapp" {href} target="_blank" rel="noopener" aria-label="Escríbanos por WhatsApp">
	<Icon name="whatsapp" />
</a>

<style>
	.whatsapp {
		position: fixed;
		right: var(--screen-pad-x);
		bottom: var(--space-12);
		z-index: var(--z-modal);
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		color: var(--success-fg);
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-round);
	}

	.whatsapp:hover {
		color: var(--success-fg);
	}

	@container (width >= 1024px) {
		.whatsapp {
			right: var(--space-14);
			bottom: var(--space-14);
		}
	}
</style>
