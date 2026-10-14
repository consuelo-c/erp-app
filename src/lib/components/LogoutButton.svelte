<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from './Button.svelte';
</script>

<!-- A form, not a link: logging out is a POST, covered by SvelteKit's checkOrigin. -->
<form method="POST" action={resolve('/logout')}>
	<Button type="submit" variant="secondary">Cerrar sesión</Button>
</form>
