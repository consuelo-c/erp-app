<script lang="ts">
	// The public pages' only contact, fixed to the bottom right: the glyph twice its regular size,
	// no text beside it. The caller builds `href`, the `wa.me` link with its message.
	let { href }: { href: string } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an outside link -->
<a class="whatsapp" {href} target="_blank" rel="noopener" aria-label="Escríbanos por WhatsApp">
	<svg class="whatsapp__glyph" aria-hidden="true"><use href="/icons.svg#whatsapp"></use></svg>
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
		width: 76px;
		height: 76px;
		color: var(--success-fg);
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-round);
	}

	.whatsapp:hover {
		color: var(--success-fg);
	}

	/* Twice the 26px glyph of every other WhatsApp link, its stroke thinned to match. */
	.whatsapp__glyph {
		width: 52px;
		height: 52px;
		fill: none;
		stroke: currentcolor;
		stroke-width: 1.25;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@container (width >= 1024px) {
		.whatsapp {
			right: var(--space-14);
			bottom: var(--space-14);
		}
	}
</style>
