<script lang="ts">
	import { resolve } from '$app/paths';
	import Chip from '$lib/components/Chip.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Select from '$lib/components/Select.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatInteger, formatPesos } from '$lib/format';
	import { CATEGORY_LABELS } from '$lib/labels';
	import type { Product, VariantGroup } from '$lib/server/services/products';

	// A failed save: its message, the field it belongs to, what was typed.
	type Submitted = { message: string; field?: string; values: Record<string, unknown> };

	interface Props {
		/** Null for a new product. */
		product: Product | null;
		groups: VariantGroup[];
		form: Submitted | null | undefined;
	}

	let { product, groups, form }: Props = $props();

	// The picker's last option. While it's picked the picker posts nothing: the typed name does.
	const NEW_GROUP = '__nuevo';

	const errorOf = (name: string) => (name === form?.field ? form.message : undefined);

	function compose(group: string, variant: string): string {
		return '' === group || '' === variant.trim() ? '' : `${group} — ${variant.trim()}`;
	}

	// A product's saved fields, named as the form posts them. A new one starts active.
	function savedFields(saved: Product | null): Record<string, unknown> {
		if (null === saved) {
			return { active: 'on' };
		}
		return {
			name: saved.name,
			category: saved.category,
			variant_group: saved.variantGroup,
			variant_name: saved.variantName,
			description: saved.description,
			rental_price: formatPesos(saved.rentalPrice),
			active: saved.isActive ? 'on' : 'off'
		};
	}

	// Read once: a save, failed or not, loads the page again. A failed one brings back what was typed.
	function readFields() {
		const posted = form?.values ?? savedFields(product);
		const text = (name: string) => String(posted[name] ?? '');
		const isNewGroup = undefined !== posted.new_variant_group;
		const fields = {
			name: text('name'),
			category: text('category'),
			group: isNewGroup ? NEW_GROUP : text('variant_group'),
			newGroup: text('new_variant_group'),
			variant: text('variant_name'),
			description: text('description'),
			rentalPrice: text('rental_price'),
			totalQuantity: text('total_quantity'),
			isActive: 'on' === posted.active
		};
		const composed = compose(isNewGroup ? fields.newGroup.trim() : fields.group, fields.variant);
		// Nombre follows the group and the variant until it's typed by hand.
		return { ...fields, isNameTyped: '' !== fields.name && composed !== fields.name };
	}

	const fields = readFields();
	let name = $state(fields.name);
	let category = $state(fields.category);
	let group = $state(fields.group);
	let newGroup = $state(fields.newGroup);
	let variant = $state(fields.variant);
	let isNameTyped = $state(fields.isNameTyped);

	const groupName = $derived(NEW_GROUP === group ? newGroup.trim() : group);

	function fillName() {
		const composed = compose(groupName, variant);
		if (!isNameTyped && '' !== composed) {
			name = composed;
		}
	}

	// An existing group brings its category; Categoría stays editable.
	function pickGroup(picked: string) {
		group = picked;
		const existing = groups.find((candidate) => picked === candidate.name);
		if (existing) {
			category = existing.category;
		}
		fillName();
	}
</script>

<UnsavedChangesGuard form="product" />

<!-- The submit button sits in the screen's action bar and reaches this form through its `form` attribute. -->
<form id="product" class="form-stack" method="POST">
	<Field
		label="Nombre"
		id="name"
		hint={'' !== group && !isNameTyped
			? 'Se llena con el grupo y la variante. Puedes cambiarlo.'
			: undefined}
		error={errorOf('name')}
	>
		<Input
			id="name"
			name="name"
			bind:value={
				() => name,
				(typed) => {
					name = typed;
					isNameTyped = '' !== typed && typed !== compose(groupName, variant);
				}
			}
			placeholder="Ej. Silla Tiffany dorada"
			aria-invalid={undefined !== errorOf('name')}
			required
		/>
	</Field>
	<Field label="Categoría" id="category" error={errorOf('category')}>
		<Select
			id="category"
			name="category"
			bind:value={category}
			aria-invalid={undefined !== errorOf('category')}
			required
		>
			<option value="" disabled>Elige una categoría</option>
			{#each Object.entries(CATEGORY_LABELS) as [key, label] (key)}
				<option value={key}>{label}</option>
			{/each}
		</Select>
	</Field>
	<Field
		label="Grupo de variantes (opcional)"
		id="variant_group"
		hint={'' === group
			? 'Para colores o tamaños del mismo producto. Cada variante lleva su precio y su inventario.'
			: undefined}
		error={errorOf('variant_group')}
	>
		<Select
			id="variant_group"
			name={NEW_GROUP === group ? undefined : 'variant_group'}
			bind:value={() => group, pickGroup}
			aria-invalid={undefined !== errorOf('variant_group')}
		>
			<option value="">Sin grupo</option>
			{#each groups as { name: groupOption } (groupOption)}
				<option value={groupOption}>{groupOption}</option>
			{/each}
			<option value={NEW_GROUP}>Nuevo grupo</option>
		</Select>
	</Field>
	{#if NEW_GROUP === group}
		<Field
			label="Nombre del grupo nuevo"
			id="new_variant_group"
			error={errorOf('new_variant_group')}
		>
			<Input
				id="new_variant_group"
				name="new_variant_group"
				bind:value={
					() => newGroup,
					(typed) => {
						newGroup = typed;
						fillName();
					}
				}
				placeholder="Ej. Mantel redondo 2.40 m"
				aria-invalid={undefined !== errorOf('new_variant_group')}
				required
			/>
		</Field>
	{/if}
	{#if '' !== group}
		<Field label="Variante" id="variant_name" error={errorOf('variant_name')}>
			<Input
				id="variant_name"
				name="variant_name"
				bind:value={
					() => variant,
					(typed) => {
						variant = typed;
						fillName();
					}
				}
				placeholder="Ej. Dorado"
				aria-invalid={undefined !== errorOf('variant_name')}
				required
			/>
		</Field>
	{/if}
	<Field label="Descripción (opcional)" id="description">
		<textarea
			id="description"
			name="description"
			rows="2"
			placeholder="Ej. Algodón, para mesa redonda de 10 puestos"
			value={fields.description}></textarea>
	</Field>
	<div class="field-row">
		<Field label="Precio por día" id="rental_price" error={errorOf('rental_price')}>
			<Input
				id="rental_price"
				name="rental_price"
				inputmode="numeric"
				value={fields.rentalPrice}
				placeholder="Ej. $2.500"
				aria-invalid={undefined !== errorOf('rental_price')}
				required
			/>
		</Field>
		<!-- Typed only on creation; afterwards incidents and counts change it, so it posts nothing. -->
		<Field
			label="Cantidad total"
			id="total_quantity"
			hint={null === product ? undefined : countHint}
			error={errorOf('total_quantity')}
		>
			{#if null === product}
				<Input
					id="total_quantity"
					name="total_quantity"
					inputmode="numeric"
					value={fields.totalQuantity}
					placeholder="Ej. 120"
					aria-invalid={undefined !== errorOf('total_quantity')}
					required
				/>
			{:else}
				<Input id="total_quantity" value={formatInteger(product.totalQuantity)} readonly />
			{/if}
		</Field>
	</div>
	<fieldset class="choice">
		<legend class="choice__legend">Estado</legend>
		<div class="choice__options">
			<Chip type="radio" name="active" value="on" label="Activo" checked={fields.isActive} />
			<Chip type="radio" name="active" value="off" label="Inactivo" checked={!fields.isActive} />
		</div>
		<p class="choice__hint">
			Los productos no se eliminan. Un producto inactivo no se ofrece en pedidos nuevos.
		</p>
	</fieldset>

	{#if form && undefined === form.field}
		<Notice tone="error">{form.message}</Notice>
	{/if}
</form>

{#snippet countHint()}
	<a href={resolve('/inventario')}>Nuevo conteo para actualizar</a>
{/snippet}

<style>
	.field-row {
		display: flex;
		gap: var(--control-gap);
	}

	.choice {
		min-width: 0;
		padding: 0;
		margin: 0;
		border: 0;
	}

	/* The same look as a Field's label. */
	.choice__legend {
		padding: 0;
		margin-bottom: var(--space-3);
		font: var(--type-label);
		color: var(--text-secondary);
	}

	/* The chips share the row, each a full tap target. */
	.choice__options {
		display: grid;
		grid-auto-columns: 1fr;
		grid-auto-flow: column;
		gap: var(--space-4);
	}

	.choice__options > :global(.chip) {
		justify-content: center;
		min-height: var(--tap-min);
	}

	.choice__hint {
		margin: var(--space-3) 0 0;
		font-size: var(--text-label);
		font-style: italic;
		color: var(--text-secondary);
	}

	textarea {
		box-sizing: border-box;
		width: 100%;
		padding: var(--space-6) var(--space-7);
		margin: 0;
		font: var(--type-input);
		color: var(--text-body);
		resize: vertical;
		outline: none;
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-input);
	}

	textarea:focus-visible {
		border-color: var(--border-strong);
	}
</style>
