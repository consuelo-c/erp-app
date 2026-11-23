<script lang="ts">
	type IconName =
		| 'file'
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
		| 'more'
		| 'back'
		| 'package'
		| 'wallet'
		| 'users'
		| 'chart'
		| 'help'
		| 'info'
		| 'external-link'
		| 'edit'
		| 'contact'
		| 'lock'
		| 'clipboard'
		| 'copy'
		| 'printer'
		| 'pin'
		| 'whatsapp'
		| 'chair'
		| 'tablecloth'
		| 'glass'
		| 'cutlery'
		| 'plate'
		| 'cloche'
		| 'sparkles';

	interface Props {
		name: IconName;
	}

	let { name }: Props = $props();
</script>

<svg class="icon" aria-hidden="true">
	<use href="/icons.svg#{name}"></use>
</svg>

<style>
	.icon {
		flex: none;
		width: var(--icon-size);
		height: var(--icon-size);
		vertical-align: middle;
		fill: none;
		stroke: currentcolor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
