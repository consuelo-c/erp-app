<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	// One of the four daily marks. The hour is always typed, never taken from the clock: every tile
	// opens the time dialog, a done one to correct it, so it's never disabled. While its dialog is
	// open the caller sets `aria-expanded`.
	type Props = HTMLButtonAttributes & {
		label: string;
		// The punch as people read it (`7:02 a.m.`), or null while it's pending.
		time: string | null;
		// What a pending tile says: «Marcar» today, «Agregar» on another day.
		pendingText: string;
	};

	let { label, time, pendingText, ...rest }: Props = $props();
</script>

<button type="button" aria-haspopup="dialog" {...rest} class={['punch', time && 'punch--done']}>
	<span class="punch__label">{label}</span>
	{#if time}
		<Icon name="check" size="sm" />{time}
	{:else}
		{pendingText}
	{/if}
</button>

<style>
	.punch {
		box-sizing: border-box;
		display: block;
		width: 100%;
		padding: var(--space-8);
		margin: 0;
		font: var(--weight-semibold) var(--text-base) / 1.3 var(--font-sans);
		color: var(--text-secondary);
		text-align: center;
		cursor: pointer;
		background: var(--surface-card);
		border: var(--border-w-strong) solid var(--border-default);
		border-radius: var(--radius-card);
	}

	.punch__label {
		display: block;
		margin-bottom: var(--space-2);
		font-size: var(--text-label);
		font-weight: var(--weight-regular);
	}

	.punch--done {
		font-weight: var(--weight-bold);
		color: var(--text-body);
		background: var(--surface-highlight);
		border-color: var(--brand-yellow);
	}

	.punch--done :global(.icon) {
		margin-right: var(--space-3);
		color: var(--success-fg);
		stroke-width: 2.5;
	}

	.punch[aria-expanded='true'] {
		border-color: var(--border-strong);
	}
</style>
