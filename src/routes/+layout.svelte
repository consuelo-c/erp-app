<script lang="ts">
	let { children } = $props();
</script>

{@render children()}

<style>
	:global(html) {
		color-scheme: only light;
	}

	:global(body) {
		margin: 0;
		background: #ffffff;
		color: #333333;
		font-family: system-ui, sans-serif;
	}
</style>
