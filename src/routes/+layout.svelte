<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();
</script>

<!-- A shared link's preview (WhatsApp, Facebook): the image must be an absolute URL; the title is
	each page's own <title>. -->
<svelte:head>
	<meta property="og:image" content="{page.url.origin}/icon-512.png" />
</svelte:head>

{@render children()}
