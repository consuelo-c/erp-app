<script lang="ts">
	import DispatchList from '../DispatchList.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<DispatchList
	tab="Ruta de hoy"
	day={data.day}
	empty="Hoy no hay entregas ni recogidas de la empresa."
	route
/>
