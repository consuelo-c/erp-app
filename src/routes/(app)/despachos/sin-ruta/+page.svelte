<script lang="ts">
	import DispatchList from '../DispatchList.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<DispatchList tab="Sin ruta" day={data.day} empty="Hoy no hay entregas ni recogidas sin ruta." />
