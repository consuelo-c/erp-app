<script lang="ts">
	type IconName =
		| 'list'
		| 'truck'
		| 'clock'
		| 'settings'
		| 'search'
		| 'trash'
		| 'close'
		| 'plus'
		| 'check'
		| 'alert'
		| 'phone'
		| 'filter'
		| 'camera'
		| 'home'
		| 'login'
		| 'exit'
		| 'collapse'
		| 'more'
		| 'back'
		| 'package'
		| 'banknote'
		| 'wallet'
		| 'users'
		| 'help'
		| 'info'
		| 'edit';

	interface Props {
		name: IconName;
		size?: 'xs' | 'sm' | 'md' | 'lg';
	}

	let { name, size }: Props = $props();
</script>

<svg class={['icon', size && `icon--${size}`]} aria-hidden="true">
	<use href="/icons.svg#{name}"></use>
</svg>

<style>
	.icon {
		flex: none;
		width: 20px;
		height: 20px;
		vertical-align: middle;
		fill: none;
		stroke: currentcolor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.icon--xs {
		width: 13px;
		height: 13px;
	}

	.icon--sm {
		width: 16px;
		height: 16px;
	}

	.icon--md {
		width: 18px;
		height: 18px;
	}

	.icon--lg {
		width: 26px;
		height: 26px;
	}
</style>
