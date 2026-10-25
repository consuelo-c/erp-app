<script lang="ts" module>
	import type { OrderStatus } from '$lib/server/services/orders';

	type StatusTone =
		| 'draft'
		| 'confirmed'
		| 'picked'
		| 'out-delivery'
		| 'delivered'
		| 'out-pickup'
		| 'completed'
		| 'cancelled';

	/** Each order status has its own color, the same on every screen. */
	export const ORDER_STATUS_TONES: Record<OrderStatus, StatusTone> = {
		DRAFT: 'draft',
		CONFIRMED: 'confirmed',
		PICKED: 'picked',
		OUT_FOR_DELIVERY: 'out-delivery',
		DELIVERED: 'delivered',
		OUT_FOR_PICKUP: 'out-pickup',
		COMPLETED: 'completed',
		CANCELLED: 'cancelled'
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	// No tone is the neutral grey (Inactivo, Retirado, a contact's services); `info` marks an employee,
	// `error` an order «Con novedad», and each status tone an order's state.
	interface Props {
		tone?: 'success' | 'info' | 'error' | StatusTone;
		children: Snippet;
	}

	let { tone, children }: Props = $props();
</script>

<span class={['badge', tone && `badge--${tone}`]}>{@render children()}</span>

<style>
	.badge {
		display: inline-block;
		padding: var(--space-2) var(--space-6);
		font: var(--type-badge);
		color: var(--neutral-600);
		white-space: nowrap;
		background: var(--neutral-50);
		border-radius: var(--radius-pill);
	}

	.badge--success {
		color: var(--success-fg);
		background: var(--success-bg);
	}

	.badge--info {
		color: var(--info-fg);
		background: var(--info-bg);
	}

	.badge--error {
		color: var(--error-fg);
		background: var(--error-bg);
	}

	.badge--draft {
		color: var(--status-draft-fg);
		background: var(--status-draft-bg);
	}

	.badge--confirmed {
		color: var(--status-confirmed-fg);
		background: var(--status-confirmed-bg);
	}

	.badge--picked {
		color: var(--status-picked-fg);
		background: var(--status-picked-bg);
	}

	.badge--out-delivery {
		color: var(--status-out-delivery-fg);
		background: var(--status-out-delivery-bg);
	}

	.badge--delivered {
		color: var(--status-delivered-fg);
		background: var(--status-delivered-bg);
	}

	.badge--out-pickup {
		color: var(--status-out-pickup-fg);
		background: var(--status-out-pickup-bg);
	}

	.badge--completed {
		color: var(--status-completed-fg);
		background: var(--status-completed-bg);
	}

	.badge--cancelled {
		color: var(--status-cancelled-fg);
		background: var(--status-cancelled-bg);
	}
</style>
