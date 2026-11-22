<script lang="ts">
	import IncidentForm from '../IncidentForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<IncidentForm order={data.order} incident={data.incident} {form} />
