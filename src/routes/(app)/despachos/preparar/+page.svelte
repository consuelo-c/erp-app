<script lang="ts">
	import DispatchList from '../DispatchList.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<DispatchList list="PREP" tab="Preparar hoy" day={data.day} empty="Hoy no hay nada que preparar." />
