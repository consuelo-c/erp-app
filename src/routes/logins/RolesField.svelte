<script lang="ts">
	import Chip from '$lib/components/Chip.svelte';
	import { ROLE_LABELS } from '$lib/labels';

	// One checkbox chip per role, all posted as `roles`; `chosen` are the ones already checked.
	let { chosen }: { chosen: readonly string[] } = $props();
</script>

<fieldset class="roles">
	<legend class="roles__legend">Roles</legend>
	<div class="chip-row roles__chips">
		{#each Object.entries(ROLE_LABELS) as [role, label] (role)}
			<Chip name="roles" value={role} {label} checked={chosen.includes(role)} />
		{/each}
	</div>
</fieldset>

<style>
	.roles {
		min-width: 0;
		padding: 0;
		margin: 0;
		border: 0;
	}

	/* The same look as a Field's label. */
	.roles__legend {
		padding: 0;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	/* Five roles wrap instead of scrolling: all of them must be visible to choose. */
	.roles__chips {
		flex-wrap: wrap;
	}
</style>
