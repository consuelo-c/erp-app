<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	// A bare glyph has no visible text, so `label` is its accessible name.
	type Props = HTMLButtonAttributes & {
		icon: ComponentProps<typeof Icon>['name'];
		label: string;
	};

	let { icon, label, ...rest }: Props = $props();
</script>

<button type="button" {...rest} class="icon-btn" aria-label={label}>
	<Icon name={icon} size="md" />
</button>

<style>
	/* 44px hit area around the glyph; the negative margin keeps it from pushing the layout. */
	.icon-btn {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		padding: 0;
		margin: -12px;
		color: inherit;
		cursor: pointer;
		background: none;
		border: 0;
	}
</style>
