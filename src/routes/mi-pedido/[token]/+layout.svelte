<script lang="ts">
	import ClientPage from '../../ClientPage.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<ClientPage whatsAppHref={data.whatsAppHref}>{@render children()}</ClientPage>
