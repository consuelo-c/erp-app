<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import { formatPesos } from '$lib/format';
	import { calculateOrderTotals } from '$lib/orders';
	import { describeRemovedProducts } from '$lib/quotes';
	import { parsePesos, parseQuantity } from '$lib/payroll';
	import { formatPhone } from '$lib/phone';
	import type { ClientCandidate } from '$lib/server/services/contacts';
	import type {
		Quote,
		QuoteDraft,
		QuoteDuplicate,
		QuoteFormOptions
	} from '$lib/server/services/quotes';
	import ClientSearch from '../pedidos/ClientSearch.svelte';
	import OrderLines, { toFormLine, type FormLine } from '../pedidos/OrderLines.svelte';
	import OrderTotals from '../pedidos/OrderTotals.svelte';

	// The order form's single screen without what a quote doesn't have: no trips, no methods, no
	// carrier, no deposit, no payments, and no availability or holiday warnings. Posted as one JSON
	// field; the server validates it and works the totals out again.
	interface Props {
		options: QuoteFormOptions;
		/** The quote being edited; null for a new one. */
		quote: Quote | null;
		/** «Duplicar» or «Cotizar de nuevo»: a new quote filled from a quote's or an order's terms, at today's prices. */
		copy?: QuoteDuplicate | null;
		/** A refused save: its message and each field's. */
		form: { message: string; errors: Record<string, string> } | null | undefined;
	}

	let { options, quote, copy = null, form }: Props = $props();

	const FORM_ID = 'quote-form';

	let isSaving = $state(false);

	type ClientChoice = number | 'new' | null;

	type Fields = {
		choice: ClientChoice;
		picked: ClientCandidate | null;
		clientName: string;
		phone: string;
		eventDate: string;
		validUntil: string;
		address1: string;
		address2: string;
		rentalDays: string;
		lines: FormLine[];
		discount: string;
		transport: string;
		notes: string;
	};

	// Empty is «por acordar», not $0: transport starts empty.
	function pesosOf(amount: number | null): string {
		return null === amount ? '' : formatPesos(amount);
	}

	type Dates = Pick<Fields, 'eventDate' | 'validUntil'>;

	// A quote's terms as the form holds them; its client as its snapshot.
	function savedFields(saved: QuoteDraft, { eventDate, validUntil }: Dates): Fields {
		const { name: fullName, phone } = saved.client;
		return {
			choice: saved.clientId,
			picked: { id: saved.clientId, fullName, phone, address1: null, address2: null },
			clientName: fullName,
			phone: formatPhone(phone),
			eventDate,
			validUntil,
			address1: saved.address1 ?? '',
			address2: saved.address2 ?? '',
			rentalDays: String(saved.rentalDays),
			lines: saved.items.map(toFormLine),
			discount: 0 === saved.discount ? '' : formatPesos(saved.discount),
			transport: pesosOf(saved.transportCost),
			notes: saved.notes ?? ''
		};
	}

	// A new quote starts empty, billed for one day, valid for the configured days; a copy, with the
	// other's terms and no event date.
	function readFields(): Fields {
		if (null !== quote) {
			return savedFields(quote, { eventDate: quote.eventDate ?? '', validUntil: quote.validUntil });
		}
		if (null !== copy) {
			return savedFields(copy.draft, { eventDate: '', validUntil: options.validUntil });
		}
		return {
			choice: null,
			picked: null,
			clientName: '',
			phone: '',
			eventDate: '',
			validUntil: options.validUntil,
			address1: '',
			address2: '',
			rentalDays: '1',
			lines: [],
			discount: '',
			transport: '',
			notes: ''
		};
	}

	// Read once: a refused save keeps this state, so what was typed is still there.
	const fields = readFields();
	let choice = $state(fields.choice);
	let picked = $state(fields.picked);
	let clientName = $state(fields.clientName);
	let phone = $state(fields.phone);
	let eventDate = $state(fields.eventDate);
	let validUntil = $state(fields.validUntil);
	let address1 = $state(fields.address1);
	let address2 = $state(fields.address2);
	let rentalDays = $state(fields.rentalDays);
	let lines = $state(fields.lines);
	let discount = $state(fields.discount);
	let transport = $state(fields.transport);
	let notes = $state(fields.notes);

	const errorOf = (path: string): string | undefined => form?.errors[path];

	const isTransportPending = $derived('' === transport.trim());
	const rentalDayCount = $derived(parseQuantity(rentalDays) || 0);
	const totals = $derived(
		calculateOrderTotals({
			lines: lines.map((line) => ({
				qty: parseQuantity(line.qty) || 0,
				unit_price: parsePesos(line.unitPrice)
			})),
			rentalDays: rentalDayCount,
			discount: parsePesos(discount),
			transportCost: isTransportPending ? 0 : parsePesos(transport)
		})
	);

	// A blank number posts nothing, so the server names the field to fill in.
	function numberOrNull(typed: string): number | null {
		return '' === typed.trim() ? null : parseQuantity(typed);
	}

	// What's posted: the quote as the service takes it. «Cliente nuevo» is a null client, and an
	// empty transport a null one, «por acordar».
	const payload = $derived(
		JSON.stringify({
			client_id: 'new' === choice ? null : (choice ?? undefined),
			client_name: clientName,
			client_phone: phone,
			event_date: eventDate,
			valid_until: validUntil,
			address_1: address1,
			address_2: address2,
			rental_days: numberOrNull(rentalDays),
			quote_items: lines.map((line) => ({
				product_id: line.productId,
				qty: numberOrNull(line.qty),
				unit_price: '' === line.unitPrice.trim() ? null : parsePesos(line.unitPrice)
			})),
			discount: '' === discount.trim() ? undefined : parsePesos(discount),
			transport_cost: isTransportPending ? null : parsePesos(transport),
			notes
		})
	);

	// Under the phone and the place, when picking a client changed them; typing there clears it.
	let phoneNote = $state('');
	let addressNote = $state('');

	// The client's phone and address fill the quote's, each with a note when it changed.
	function pick(candidate: ClientCandidate) {
		clientName = candidate.fullName;
		const note = `Cambió al escoger a ${candidate.fullName}.`;
		const newPhone = formatPhone(candidate.phone);
		phoneNote = newPhone === phone ? '' : note;
		phone = newPhone;
		addressNote = '';
		if (null !== candidate.address1) {
			const newAddress2 = candidate.address2 ?? '';
			const isSame = candidate.address1 === address1 && newAddress2 === address2;
			addressNote = isSame ? '' : note;
			address1 = candidate.address1;
			address2 = newAddress2;
		}
	}

	// A new client starts blank: name, phone and the place.
	function pickNewClient() {
		clientName = '';
		phone = '';
		address1 = '';
		address2 = '';
		phoneNote = '';
		addressNote = '';
	}
</script>

<form
	id={FORM_ID}
	class="quote"
	method="POST"
	aria-busy={isSaving}
	use:enhance={() => {
		isSaving = true;
		return async ({ update }) => {
			await update({ reset: false });
			isSaving = false;
		};
	}}
>
	<input type="hidden" name="quote" value={payload} />

	{#if form}
		<div class="quote__notice"><Notice tone="error">{form.message}</Notice></div>
	{/if}

	{#if copy}
		{@const id = String(copy.source.id)}
		<div class="quote__notice">
			<Notice tone="info">
				{#if 'ORDER' === copy.source.kind}
					Desde el pedido
					<a href={resolve('/(app)/pedidos/[id]', { id })}>#{id}</a>
				{:else}
					Copia de la cotización
					<a href={resolve('/(app)/cotizaciones/[id]', { id })}>#{id}</a>
				{/if}
				a los precios de hoy: el cliente, el lugar, los días, el descuento, el transporte, las notas y
				los productos con sus cantidades. La fecha del evento queda vacía y la vigencia empieza de nuevo.
			</Notice>
		</div>
	{/if}

	<div class="quote__main">
		<ClientSearch
			bind:choice
			bind:picked
			onpick={pick}
			onnew={pickNewClient}
			error={errorOf('client_id')}
		/>

		<div class="field-row">
			<Field label="Nombre" id="client-name" error={errorOf('client_name')}>
				<Input
					id="client-name"
					placeholder="Ej. Postobón S.A."
					aria-invalid={undefined !== errorOf('client_name')}
					bind:value={clientName}
				/>
			</Field>
			<Field label="Teléfono" id="phone" error={errorOf('client_phone')} hint={phoneNote}>
				<Input
					id="phone"
					inputmode="tel"
					autocomplete="off"
					placeholder="310 442 8890"
					aria-invalid={undefined !== errorOf('client_phone')}
					bind:value={phone}
					oninput={() => (phoneNote = '')}
				/>
			</Field>
		</div>

		<div class="field-row">
			<Field label="Fecha del evento (opcional)" id="event-date" error={errorOf('event_date')}>
				<Input
					id="event-date"
					type="date"
					aria-invalid={undefined !== errorOf('event_date')}
					bind:value={eventDate}
				/>
			</Field>
			<Field
				label="Válida hasta"
				id="valid-until"
				error={errorOf('valid_until')}
				hint={quote
					? ''
					: `Empieza en hoy más ${options.validityDays} días, la vigencia de Configuración.`}
			>
				<Input
					id="valid-until"
					type="date"
					required
					aria-invalid={undefined !== errorOf('valid_until')}
					bind:value={validUntil}
				/>
			</Field>
		</div>

		<Field
			label="Lugar del evento (opcional)"
			id="address"
			error={errorOf('address_1')}
			hint={addressNote}
		>
			<div class="address" oninput={() => (addressNote = '')}>
				<Input
					id="address"
					placeholder="Ej. Hacienda Fizebad, km 38 vía Las Palmas"
					aria-invalid={undefined !== errorOf('address_1')}
					bind:value={address1}
				/>
				<Input
					aria-label="Lugar del evento, segunda línea"
					placeholder="Ej. Salón principal (opcional)"
					bind:value={address2}
				/>
			</div>
		</Field>

		<div class="field--narrow">
			<Field label="Días cobrados" id="rental-days" error={errorOf('rental_days')}>
				<Input
					id="rental-days"
					inputmode="numeric"
					aria-invalid={undefined !== errorOf('rental_days')}
					bind:value={rentalDays}
				/>
			</Field>
		</div>

		{#if copy && describeRemovedProducts(copy.removed)}
			<Notice tone="info">{describeRemovedProducts(copy.removed)}</Notice>
		{/if}

		<OrderLines
			bind:lines
			products={options.products}
			rentalDays={rentalDayCount}
			{errorOf}
			field="quote_items"
		/>

		<Field label="Notas (opcional)" id="notes" hint="Salen impresas en la cotización.">
			<textarea
				class="notes"
				id="notes"
				rows="3"
				placeholder="Ej. Precios incluyen montaje y desmontaje"
				bind:value={notes}></textarea>
		</Field>
	</div>

	<div class="quote__side">
		<OrderTotals
			bind:discount
			bind:transport
			itemsTotal={totals.itemsTotal}
			total={totals.orderTotal}
			{errorOf}
			totalLabel={isTransportPending ? 'Total sin transporte' : 'Total'}
			transportPlaceholder="Por acordar"
			transportHint={isTransportPending
				? 'Vacío queda por acordar. Si no se cobra, escribe 0.'
				: 'Si lo borras, queda por acordar.'}
		/>

		<div class="quote__save">
			<Button type="submit" disabled={isSaving}>Guardar cotización</Button>
		</div>
	</div>
</form>

<UnsavedChangesGuard form={FORM_ID} />

<style>
	.quote {
		display: flex;
		flex-direction: column;
		gap: var(--space-11);
	}

	.quote__main,
	.quote__side {
		display: flex;
		flex-direction: column;
		gap: var(--space-9);
		min-width: 0;
	}

	.quote__notice {
		margin-bottom: calc(-1 * var(--space-4));
	}

	.quote__save {
		margin-top: var(--space-4);
	}

	.field-row {
		display: flex;
		gap: var(--control-gap);
	}

	.field-row > :global(*) {
		flex: 1;
		min-width: 0;
	}

	.field--narrow {
		width: 110px;
	}

	.address {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.notes {
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

	.notes:focus-visible {
		border-color: var(--border-strong);
	}

	/* A desktop: as the order's, the quote on the left, its money and saving on the right. */
	@container (width >= 1280px) {
		.quote {
			display: grid;
			grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr);
			column-gap: var(--space-12);
			align-items: start;
		}

		.quote__notice {
			grid-column: 1 / -1;
			margin-bottom: 0;
		}

		.quote__side {
			position: sticky;
			top: 0;
			padding-left: var(--space-12);
			border-left: var(--border-w-hair) solid var(--border-default);
		}
	}
</style>
