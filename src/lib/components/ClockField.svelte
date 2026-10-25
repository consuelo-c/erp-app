<script lang="ts">
	import Chip from './Chip.svelte';
	import Input from './Input.svelte';

	// A clock time typed the way people say it: hour and minutes on the number pad, then a.m. or
	// p.m. The fields post as `${prefix}hour`, `${prefix}minute` and `${prefix}period`.
	interface Props {
		legend: string;
		prefix?: string;
		hour: string;
		minute: string;
		period: 'am' | 'pm';
		// The form the fields belong to, when they sit outside it.
		form?: string;
		placeholder?: { hour: string; minute: string } | null;
		error?: string;
		// An optional time posts nothing when its hour is left blank.
		optional?: boolean;
	}

	let {
		legend,
		prefix = '',
		hour = $bindable(),
		minute = $bindable(),
		period = $bindable(),
		form,
		placeholder,
		error,
		optional = false
	}: Props = $props();
</script>

<fieldset class="clock">
	<legend class="clock__legend">{legend}</legend>
	<div class="clock__row">
		<Input
			{form}
			name="{prefix}hour"
			inputmode="numeric"
			maxlength={2}
			autocomplete="off"
			aria-label="Hora"
			aria-invalid={undefined !== error}
			placeholder={placeholder?.hour}
			required={!optional}
			bind:value={hour}
		/>
		<span class="clock__colon">:</span>
		<Input
			{form}
			name="{prefix}minute"
			inputmode="numeric"
			maxlength={2}
			autocomplete="off"
			aria-label="Minutos"
			aria-invalid={undefined !== error}
			placeholder={placeholder?.minute}
			bind:value={minute}
		/>
		{#each ['am', 'pm'] as const as value (value)}
			<Chip
				type="radio"
				{form}
				name="{prefix}period"
				{value}
				label={'am' === value ? 'a.m.' : 'p.m.'}
				checked={value === period}
				onchange={() => (period = value)}
			/>
		{/each}
	</div>
	{#if error}
		<p class="clock__error">{error}</p>
	{/if}
</fieldset>

<style>
	.clock {
		min-width: 0;
		padding: 0;
		margin: 0;
		border: 0;
	}

	/* The same look as a Field's label. */
	.clock__legend {
		padding: 0;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	/* Two short number fields, then the a.m./p.m. chips. */
	.clock__row {
		display: grid;
		grid-template-columns: 4rem auto 4rem auto auto;
		gap: var(--space-3);
		align-items: center;

		/* On a wide screen the free space stays at the end instead of stretching the chips. */
		justify-content: start;
	}

	.clock__colon {
		font-weight: var(--weight-bold);
	}

	/* The same look as a Field's error. */
	.clock__error {
		margin: var(--space-3) 0 0;
		font-size: var(--text-label);
		font-weight: var(--weight-semibold);
		color: var(--error-fg);
	}
</style>
