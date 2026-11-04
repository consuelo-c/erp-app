<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import ClockField from '$lib/components/ClockField.svelte';
	import Field from '$lib/components/Field.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Select from '$lib/components/Select.svelte';
	import UnsavedChangesGuard from '$lib/components/UnsavedChangesGuard.svelte';
	import {
		addDays,
		formatCivilDate,
		formatClockTime,
		formatDayRange,
		formatLongDay,
		formatShortDay,
		toDialTime,
		typedClockTime
	} from '$lib/datetime';
	import { formatPesos, formatReceiptNumber, formatSignedPesos } from '$lib/format';
	import {
		CASH_CONCEPT_LABELS,
		DELIVERY_METHOD_LABELS,
		PAYMENT_METHOD_LABELS,
		RETURN_METHOD_LABELS
	} from '$lib/labels';
	import { calculateOrderTotals } from '$lib/orders';
	import { parsePesos, parseQuantity } from '$lib/payroll';
	import { formatPhone } from '$lib/phone';
	import type { ClientCandidate } from '$lib/server/services/contacts';
	import type {
		DeliveryMethod,
		OrderDetail,
		OrderFormOptions,
		OrderSchedule,
		ReturnMethod
	} from '$lib/server/services/orders';
	import type { QuoteConversion } from '$lib/server/services/quotes';
	import ClientSearch from './ClientSearch.svelte';
	import OrderLines, { toFormLine, type FormLine } from './OrderLines.svelte';
	import OrderTotals from './OrderTotals.svelte';

	// One screen, top to bottom, no wizard: the salesperson fills it in while the client talks.
	// Everything is typed into local state and posted as one JSON field; the server validates it
	// and works the totals out again. Availability, holidays and clashes only warn.
	interface Props {
		options: OrderFormOptions;
		/** Null for a new order. */
		order: OrderDetail | null;
		/** The delivered order a new extension comes from. */
		original?: OrderDetail | null;
		/** «Convertir en pedido»: the quote a new order comes from. */
		conversion?: QuoteConversion | null;
		/** A refused save: its message and each field's. */
		form: { message: string; errors: Record<string, string> } | null | undefined;
	}

	let { options, order, original = null, conversion = null, form }: Props = $props();

	// While the save is on its way, so the button doesn't post it twice.
	let isSaving = $state(false);

	const FORM_ID = 'order-form';
	const EMPTY_TIME = { hour: '', minute: '', period: 'am' as const };

	// The company's warehouse: where the client picks up or brings back.
	const warehouse = $derived({
		address1: options.company.address,
		address2: `Bodega ${options.company.name}`
	});

	type ClientChoice = number | 'new' | null;
	type Trip = { carrierId: string; address1: string; address2: string };

	type DialTime = { hour: string; minute: string; period: 'am' | 'pm' };

	function dialOf(time: string | null): DialTime {
		return null === time ? { ...EMPTY_TIME } : toDialTime(time);
	}

	function tripOf(
		trip: Pick<OrderDetail['delivery'], 'carrier' | 'address_1' | 'address_2'>
	): Trip {
		return {
			carrierId: null === trip.carrier ? '' : String(trip.carrier.id),
			address1: trip.address_1,
			address2: trip.address_2 ?? ''
		};
	}

	// The order's client as its snapshot: the contact may have changed since.
	function ownClient(saved: OrderDetail): ClientCandidate {
		const { name: fullName, phone } = saved.client;
		return { id: saved.clientId, fullName, phone, address1: null, address2: null };
	}

	function pesosOf(amount: number): string {
		return 0 === amount ? '' : formatPesos(amount);
	}

	type Fields = {
		phone: string;
		eventDate: string;
		choice: ClientChoice;
		picked: ClientCandidate | null;
		clientName: string;
		deliveryDate: string;
		pickupDate: string;
		deliveryTime: DialTime;
		pickupTime: DialTime;
		rentalDays: string;
		lines: FormLine[];
		deliveryMethod: DeliveryMethod;
		returnMethod: ReturnMethod;
		delivery: Trip;
		pickup: Trip;
		isPickupTyped: boolean;
		notes: string;
		discount: string;
		transport: string;
		deposit: string;
	};

	const EMPTY_TRIP: Trip = { carrierId: '', address1: '', address2: '' };

	// A new order starts empty, billed for one day.
	const NEW_ORDER: Fields = {
		phone: '',
		eventDate: '',
		choice: null,
		picked: null,
		clientName: '',
		deliveryDate: '',
		pickupDate: '',
		deliveryTime: EMPTY_TIME,
		pickupTime: EMPTY_TIME,
		rentalDays: '1',
		lines: [],
		deliveryMethod: 'COMPANY_DELIVERY',
		returnMethod: 'COMPANY_PICKUP',
		delivery: EMPTY_TRIP,
		pickup: EMPTY_TRIP,
		isPickupTyped: false,
		notes: '',
		discount: '',
		transport: '',
		deposit: ''
	};

	// A saved order's fields as the form holds them: numbers and pesos as text, times as typed.
	function savedFields(saved: OrderDetail): Fields {
		const { delivery: trip, pickup: back } = saved;
		return {
			phone: formatPhone(saved.client.phone),
			eventDate: saved.eventDate,
			choice: saved.clientId,
			picked: ownClient(saved),
			clientName: saved.client.name,
			deliveryDate: saved.deliveryDate,
			pickupDate: saved.pickupDate,
			deliveryTime: dialOf(trip.time),
			pickupTime: dialOf(back.time),
			rentalDays: String(saved.rentalDays),
			lines: saved.items.map(toFormLine),
			deliveryMethod: trip.method,
			returnMethod: back.method,
			delivery: tripOf(trip),
			pickup: tripOf(back),
			// The pickup address follows the delivery address until it's typed by hand.
			isPickupTyped: trip.address_1 !== back.address_1 || trip.address_2 !== back.address_2,
			notes: saved.notes ?? '',
			discount: pesosOf(saved.discount),
			transport: pesosOf(saved.transportCost),
			deposit: pesosOf(saved.depositAmount)
		};
	}

	// An extension starts as its original: the client, the trips and every line. Its dates, from the
	// day after the original's pickup, and its money are its own.
	function extensionFields(from: OrderDetail): Fields {
		return {
			...savedFields(from),
			deliveryDate: addDays(from.pickupDate, 1),
			pickupDate: '',
			rentalDays: '1',
			notes: '',
			discount: '',
			transport: '',
			deposit: ''
		};
	}

	// A quote's order starts with its client as the contact is today, «Lugar del evento» as both
	// addresses, and its terms and lines as quoted. The trips are the salesperson's, and a «por
	// acordar» transport stays empty: «Guardar pedido» asks for it.
	function quotedFields({ quote, client }: QuoteConversion): Fields {
		const address = {
			carrierId: '',
			address1: quote.address1 ?? '',
			address2: quote.address2 ?? ''
		};
		return {
			...structuredClone(NEW_ORDER),
			phone: formatPhone(client.phone),
			eventDate: quote.eventDate ?? '',
			choice: client.id,
			picked: client,
			clientName: client.fullName,
			rentalDays: String(quote.rentalDays),
			lines: quote.items.map(toFormLine),
			delivery: address,
			notes: quote.notes ?? '',
			discount: pesosOf(quote.discount),
			transport: null === quote.transportCost ? '' : formatPesos(quote.transportCost)
		};
	}

	// What the quote filled, and what's left for the salesperson.
	const isTransportPending = $derived(null === conversion?.quote.transportCost);
	const quoteNote = $derived(
		isTransportPending
			? 'el descuento y las notas. Faltan las fechas, los métodos y el transporte.'
			: 'el descuento, el transporte y las notas. Faltan las fechas y los métodos.'
	);

	// As the printed date reads: `1 dic. 2026`.
	function expiredOn(validUntil: string): string {
		return formatCivilDate(validUntil).replace(/ (\d{4})$/, '. $1');
	}

	function readFields(): Fields {
		if (null !== original) {
			return extensionFields(original);
		}
		if (null !== conversion) {
			return quotedFields(conversion);
		}
		return null === order ? structuredClone(NEW_ORDER) : savedFields(order);
	}

	// Read once: a refused save keeps this state, so what was typed is still there.
	const fields = readFields();
	let phone = $state(fields.phone);
	let eventDate = $state(fields.eventDate);
	let choice = $state(fields.choice);
	let clientName = $state(fields.clientName);
	let deliveryDate = $state(fields.deliveryDate);
	let pickupDate = $state(fields.pickupDate);
	let deliveryTime = $state(fields.deliveryTime);
	let pickupTime = $state(fields.pickupTime);
	let rentalDays = $state(fields.rentalDays);
	let lines = $state(fields.lines);
	let deliveryMethod = $state(fields.deliveryMethod);
	let returnMethod = $state(fields.returnMethod);
	let delivery = $state(fields.delivery);
	let pickup = $state(fields.pickup);
	let isPickupTyped = $state(fields.isPickupTyped);
	let notes = $state(fields.notes);
	let discount = $state(fields.discount);
	let transport = $state(fields.transport);
	let deposit = $state(fields.deposit);
	let schedule = $state<OrderSchedule | null>(null);

	const errorOf = (path: string): string | undefined => form?.errors[path];

	let picked = $state(fields.picked);

	const pickupAddress = $derived(
		isPickupTyped ? pickup : { ...pickup, address1: delivery.address1, address2: delivery.address2 }
	);

	const rentalDayCount = $derived(parseQuantity(rentalDays) || 0);
	const totals = $derived(
		calculateOrderTotals({
			lines: lines.map((line) => ({
				qty: parseQuantity(line.qty) || 0,
				unit_price: parsePesos(line.unitPrice)
			})),
			rentalDays: rentalDayCount,
			discount: parsePesos(discount),
			transportCost: parsePesos(transport)
		})
	);

	const availability = $derived(
		null === schedule
			? null
			: new Map(schedule.availability.map((each) => [each.productId, each.available]))
	);
	const rangeLabel = $derived(
		deliveryDate && pickupDate ? formatDayRange(deliveryDate, pickupDate) : ''
	);

	// A blank number posts nothing, so the server names the field to fill in.
	function numberOrNull(typed: string): number | null {
		return '' === typed.trim() ? null : parseQuantity(typed);
	}

	function pesosOrUndefined(typed: string): number | undefined {
		return '' === typed.trim() ? undefined : parsePesos(typed);
	}

	function carrierIdOf(carrierId: string): number | null {
		return '' === carrierId ? null : Number(carrierId);
	}

	// What's posted: the order as the service takes it. «Cliente nuevo» is a null client.
	const payload = $derived(
		JSON.stringify({
			client_id: 'new' === choice ? null : (choice ?? undefined),
			client_name: clientName,
			client_phone: phone,
			event_date: eventDate,
			delivery_date: deliveryDate,
			pickup_date: pickupDate,
			rental_days: numberOrNull(rentalDays),
			delivery_attributes: {
				method: deliveryMethod,
				time: typedClockTime(deliveryTime),
				address_1: delivery.address1,
				address_2: delivery.address2,
				carrier_id: carrierIdOf(delivery.carrierId)
			},
			pickup_attributes: {
				method: returnMethod,
				time: typedClockTime(pickupTime),
				address_1: pickupAddress.address1,
				address_2: pickupAddress.address2,
				carrier_id: carrierIdOf(pickup.carrierId)
			},
			order_items: lines.map((line) => ({
				product_id: line.productId,
				qty: numberOrNull(line.qty),
				unit_price: '' === line.unitPrice.trim() ? null : parsePesos(line.unitPrice)
			})),
			discount: pesosOrUndefined(discount),
			transport_cost: pesosOrUndefined(transport),
			deposit_amount: pesosOrUndefined(deposit),
			notes
		})
	);

	// What the trips' dates and times leave available, and what to warn about, as they change.
	const scheduleQuery = $derived.by(() => {
		const times = [
			['hora_entrega', typedClockTime(deliveryTime)],
			['hora_recogida', typedClockTime(pickupTime)]
		];
		const typedTimes = times.filter(([, time]) => null !== time && /^\d{2}:\d{2}$/.test(time));
		const edited = order ? [['pedido', String(order.id)]] : [];
		const entries = [['entrega', deliveryDate], ['recogida', pickupDate], ...typedTimes, ...edited];
		return String(new URLSearchParams(entries as [string, string][]));
	});

	let scheduleTimer: ReturnType<typeof setTimeout> | undefined;
	let checkedQuery = '';

	// Anything typed in the form asks again, but only when the dates or times changed.
	function refreshSchedule() {
		const query = scheduleQuery;
		if (query === checkedQuery) {
			return;
		}
		checkedQuery = query;
		clearTimeout(scheduleTimer);
		scheduleTimer = setTimeout(async () => {
			const response = await fetch(`${resolve('/pedidos/disponibilidad')}?${query}`);
			if (response.ok && query === checkedQuery) {
				schedule = await response.json();
			}
		}, 300);
	}

	// An order being edited already has dates: its warnings show at once.
	onMount(refreshSchedule);

	// Under the phone and the address, when picking a client changed them; typing there clears it.
	let phoneNote = $state('');
	let addressNote = $state('');

	// The client's phone and address fill the order's, each with a note when it changed.
	function pick(candidate: ClientCandidate) {
		clientName = candidate.fullName;
		const note = `Cambió al escoger a ${candidate.fullName}.`;
		const newPhone = formatPhone(candidate.phone);
		phoneNote = newPhone === phone ? '' : note;
		phone = newPhone;
		addressNote = '';
		if ('CLIENT_PICKUP' !== deliveryMethod && null !== candidate.address1) {
			const address2 = candidate.address2 ?? '';
			const isSame = candidate.address1 === delivery.address1 && address2 === delivery.address2;
			addressNote = isSame ? '' : note;
			delivery.address1 = candidate.address1;
			delivery.address2 = address2;
		}
	}

	// A new client starts blank: name, phone and the delivery address, unless it's the warehouse's.
	function pickNewClient() {
		clientName = '';
		phone = '';
		phoneNote = '';
		addressNote = '';
		if ('CLIENT_PICKUP' !== deliveryMethod) {
			delivery.address1 = '';
			delivery.address2 = '';
		}
	}

	// A client picking up at the warehouse: the delivery address is the company's, still editable.
	function changeDeliveryMethod() {
		if ('CLIENT_PICKUP' === deliveryMethod) {
			delivery.address1 = warehouse.address1;
			delivery.address2 = warehouse.address2;
		}
	}

	function changeReturnMethod() {
		if ('CLIENT_RETURN' === returnMethod) {
			pickup.address1 = warehouse.address1;
			pickup.address2 = warehouse.address2;
			isPickupTyped = true;
		}
	}

	// Typing in the pickup address keeps what it showed and stops following the delivery's.
	function typePickup(line: 'address1' | 'address2', value: string) {
		if (!isPickupTyped) {
			pickup.address1 = delivery.address1;
			pickup.address2 = delivery.address2;
			isPickupTyped = true;
		}
		pickup[line] = value;
	}

	function tripLabel(trip: 'DELIVERY' | 'PICKUP'): string {
		return 'DELIVERY' === trip ? 'entrega' : 'recogida';
	}
</script>

{#snippet carrierPicker(id: string, label: string, trip: Trip)}
	{@const saved = order ?? original}
	{@const current = 'delivery-carrier' === id ? saved?.delivery.carrier : saved?.pickup.carrier}
	<Field
		{label}
		{id}
		error={errorOf(`${'delivery-carrier' === id ? 'delivery' : 'pickup'}_attributes.carrier_id`)}
	>
		<Select {id} bind:value={trip.carrierId}>
			<option value="">Selecciona un transportador</option>
			{#each options.transporters as transporter (transporter.id)}
				<option value={String(transporter.id)}>
					{transporter.fullName} · {formatPhone(transporter.phone)}
				</option>
			{/each}
			<!-- A carrier no longer listed stays on the order it was picked for. -->
			{#if current && !options.transporters.some((each) => current.id === each.id)}
				<option value={String(current.id)}>{current.name} · {formatPhone(current.phone)}</option>
			{/if}
		</Select>
	</Field>
{/snippet}

<form
	id={FORM_ID}
	class="order"
	method="POST"
	aria-busy={isSaving}
	oninput={refreshSchedule}
	use:enhance={() => {
		isSaving = true;
		return async ({ update }) => {
			await update({ reset: false });
			isSaving = false;
		};
	}}
>
	<input type="hidden" name="order" value={payload} />

	{#if form}
		<div class="order__notice"><Notice tone="error">{form.message}</Notice></div>
	{/if}

	{#if conversion}
		{@const { quote } = conversion}
		<div class="order__notice">
			<Notice tone="info">
				Desde la cotización
				<a href={resolve('/(app)/cotizaciones/[id]', { id: String(quote.id) })}>#{quote.id}</a>: el
				cliente, las líneas con sus precios, los días, {quoteNote}
			</Notice>
		</div>
		{#if 'EXPIRED' === quote.state}
			<div class="order__notice">
				<Notice tone="warning">
					⚠ Esta cotización venció el {expiredOn(quote.validUntil)}; los precios pueden haber
					cambiado.
				</Notice>
			</div>
		{/if}
	{/if}

	{#if original}
		<div class="order__notice">
			<Notice tone="info">
				Sale del pedido
				<a href={resolve('/(app)/pedidos/[id]', { id: String(original.id) })}>#{original.id}</a>
				(Entregado): las líneas, con sus precios, el cliente, las direcciones y los métodos. Se guarda
				como Entregado.
			</Notice>
		</div>
	{/if}

	<div class="order__main">
		<ClientSearch
			bind:choice
			bind:picked
			onpick={pick}
			onnew={pickNewClient}
			error={errorOf('client_id')}
		/>

		<div class="field-row field-row--stack">
			<Field label="Nombre" id="client-name" error={errorOf('client_name')}>
				<Input
					id="client-name"
					placeholder="Ej. Luz Marina Restrepo"
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

		<section class="section">
			<h2 class="section-title">Información del evento</h2>
			<div class="field-row">
				<Field label="Fecha del evento" id="event-date" error={errorOf('event_date')}>
					<Input
						id="event-date"
						type="date"
						aria-invalid={undefined !== errorOf('event_date')}
						bind:value={eventDate}
					/>
				</Field>
				<Field label="Días cobrados" id="rental-days" error={errorOf('rental_days')}>
					<Input
						id="rental-days"
						inputmode="numeric"
						aria-invalid={undefined !== errorOf('rental_days')}
						bind:value={rentalDays}
					/>
				</Field>
			</div>
		</section>

		<section class="section">
			<h2 class="section-title">Despacho</h2>
			<!-- Each trip keeps its when, how and where together: bodega and the driver read it as one. -->
			<div class="trips">
				<div class="trip">
					<Field
						label="↧ Entrega"
						id="delivery-date"
						error={errorOf('delivery_date')}
						hint={original ? `El día siguiente a la recogida del pedido #${original.id}.` : ''}
					>
						<Input
							id="delivery-date"
							type="date"
							disabled={null !== original}
							aria-invalid={undefined !== errorOf('delivery_date')}
							bind:value={deliveryDate}
						/>
					</Field>
					<ClockField
						legend="Hora (opcional)"
						prefix="delivery-"
						optional
						placeholder={null}
						error={errorOf('delivery_attributes.time')}
						bind:hour={deliveryTime.hour}
						bind:minute={deliveryTime.minute}
						bind:period={deliveryTime.period}
					/>
					<Field label="Método de entrega" id="delivery-method">
						<Select
							id="delivery-method"
							bind:value={deliveryMethod}
							onchange={changeDeliveryMethod}
						>
							{#each Object.entries(DELIVERY_METHOD_LABELS) as [method, label] (method)}
								<option value={method}>{label}</option>
							{/each}
						</Select>
					</Field>
					{#if 'EXTERNAL_CARRIER' === deliveryMethod}
						{@render carrierPicker('delivery-carrier', 'Transportador de la entrega', delivery)}
					{/if}
					<Field
						label="Dirección de entrega"
						id="delivery-address"
						error={errorOf('delivery_attributes.address_1')}
						hint={'CLIENT_PICKUP' === deliveryMethod
							? 'La de la empresa, porque recoge el cliente. Puedes cambiarla.'
							: addressNote || '\u00a0'}
					>
						<div class="address" oninput={() => (addressNote = '')}>
							<Input
								id="delivery-address"
								placeholder="Ej. Cra 43A #18-95, El Poblado"
								aria-invalid={undefined !== errorOf('delivery_attributes.address_1')}
								bind:value={delivery.address1}
							/>
							<Input
								aria-label="Dirección de entrega, segunda línea"
								placeholder="Ej. Salón Social Torre Verde, piso 2 (opcional)"
								bind:value={delivery.address2}
							/>
						</div>
					</Field>
				</div>
				<div class="trip">
					<Field label="↥ Recogida" id="pickup-date" error={errorOf('pickup_date')}>
						<Input
							id="pickup-date"
							type="date"
							aria-invalid={undefined !== errorOf('pickup_date')}
							bind:value={pickupDate}
						/>
					</Field>
					<ClockField
						legend="Hora (opcional)"
						prefix="pickup-"
						optional
						placeholder={null}
						error={errorOf('pickup_attributes.time')}
						bind:hour={pickupTime.hour}
						bind:minute={pickupTime.minute}
						bind:period={pickupTime.period}
					/>
					<Field label="Método de retorno" id="return-method">
						<Select id="return-method" bind:value={returnMethod} onchange={changeReturnMethod}>
							{#each Object.entries(RETURN_METHOD_LABELS) as [method, label] (method)}
								<option value={method}>{label}</option>
							{/each}
						</Select>
					</Field>
					{#if 'EXTERNAL_CARRIER' === returnMethod}
						{@render carrierPicker('pickup-carrier', 'Transportador del retorno', pickup)}
					{/if}
					<Field
						label="Dirección de recogida"
						id="pickup-address"
						error={errorOf('pickup_attributes.address_1')}
						hint={'CLIENT_RETURN' === returnMethod
							? 'La de la empresa, porque devuelve el cliente. Puedes cambiarla.'
							: 'Sale de la dirección de entrega. Puedes cambiarla.'}
					>
						<div class="address">
							<Input
								id="pickup-address"
								placeholder="Igual a la de entrega"
								aria-invalid={undefined !== errorOf('pickup_attributes.address_1')}
								value={pickupAddress.address1}
								oninput={(event) => typePickup('address1', event.currentTarget.value)}
							/>
							<Input
								aria-label="Dirección de recogida, segunda línea"
								placeholder="(opcional)"
								value={pickupAddress.address2}
								oninput={(event) => typePickup('address2', event.currentTarget.value)}
							/>
						</div>
					</Field>
				</div>
			</div>

			<!-- Warnings never block: they can all show at once and the order still saves. -->
			{#if schedule}
				<div class="warnings">
					{#each schedule.warnings.holidays as holiday (holiday.trip)}
						<Notice tone="warning">
							⚠ La {tripLabel(holiday.trip)}, {formatShortDay(holiday.date)}, es festivo ({holiday.label}).
							Puedes continuar igual.
						</Notice>
					{/each}
					{#each schedule.warnings.clashes as clash (`${clash.trip}-${clash.orderId}`)}
						<Notice tone="warning">
							⚠ El pedido #{clash.orderId} también tiene {tripLabel(clash.theirTrip)} el
							{formatShortDay(clash.date)} a las {formatClockTime(clash.time)}. Puedes continuar
							igual.
						</Notice>
					{/each}
				</div>
			{/if}
		</section>

		<OrderLines
			bind:lines
			products={options.products}
			{availability}
			{rangeLabel}
			rentalDays={rentalDayCount}
			{errorOf}
			{original}
		/>

		<section class="section">
			<h2 class="section-title"><label for="notes">Notas</label></h2>
			<textarea
				class="notes"
				id="notes"
				rows="3"
				placeholder="Ej. Entrar por el portón de servicio"
				aria-describedby="notes-hint"
				bind:value={notes}></textarea>
			<p class="note" id="notes-hint">Opcional: lo que bodega y el conductor deben saber.</p>
		</section>
	</div>

	<div class="order__side">
		<OrderTotals
			bind:discount
			bind:transport
			itemsTotal={totals.itemsTotal}
			total={totals.orderTotal}
			{errorOf}
			transportPlaceholder={isTransportPending ? 'Por acordar' : '$0'}
		/>

		<div class="deposit">
			<Field
				label="Depósito de garantía"
				id="deposit"
				hint="Aparte: no suma al total."
				error={errorOf('deposit_amount')}
			>
				<Input
					id="deposit"
					inputmode="numeric"
					placeholder="$0"
					aria-invalid={undefined !== errorOf('deposit_amount')}
					bind:value={deposit}
				/>
			</Field>
		</div>

		<h2 class="section-title">Pagos</h2>
		{#if order}
			{#if order.payments.length}
				<ul class="detail-list">
					{#each order.payments as payment (payment.id)}
						<li>
							<span>
								{formatLongDay(payment.movementDate)} · {CASH_CONCEPT_LABELS[payment.concept]} ·
								{payment.otherMethod ?? PAYMENT_METHOD_LABELS[payment.method]}
								<span class="meta">Recibo # {formatReceiptNumber(payment.receiptNumber)}</span>
							</span>
							<span>{formatSignedPesos(payment.amount)}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="note">Sin pagos todavía.</p>
			{/if}
		{:else}
			<p class="note">Los pagos se registran cuando el pedido esté guardado.</p>
		{/if}

		<div class="order__save">
			<Button type="submit" disabled={isSaving}>
				{original ? 'Guardar extensión' : 'Guardar pedido'}
			</Button>
		</div>
	</div>
</form>

<UnsavedChangesGuard form={FORM_ID} />

<style>
	p {
		margin: 0;
	}

	.order {
		display: flex;
		flex-direction: column;
		gap: var(--space-11);
	}

	.order__main,
	.order__side {
		display: flex;
		flex-direction: column;
		gap: var(--space-9);
		min-width: 0;
	}

	.order__notice {
		margin-bottom: calc(-1 * var(--space-4));
	}

	.order__save {
		margin-top: var(--space-4);
	}

	.section-title {
		margin: var(--space-4) 0 0;
	}

	.field-row {
		display: flex;
		gap: var(--control-gap);
	}

	.field-row > :global(*) {
		flex: 1;
		min-width: 0;
	}

	/* Side by side on a phone, a long name gets cut off. */
	.field-row--stack {
		flex-direction: column;
		gap: var(--space-9);
	}

	/* The delivery address always shows a hint line, blank if need be, so both trips end level.
	   A taller one (a carrier, an extension's hint) leaves the other short, not stretched. */
	.trips {
		display: grid;
		gap: var(--space-8);
		align-items: start;
	}

	.trip {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.warnings {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.address {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-9);
	}

	/* Closer to its fields than they are to each other, so it reads as their title. */
	.section .section-title {
		margin: 0 0 calc(var(--space-5) - var(--space-9));
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

	.detail-list .meta {
		display: block;
	}

	@container (width >= 1024px) {
		.trips {
			position: relative;
			grid-template-columns: 1fr 1fr;
			column-gap: calc(2 * var(--space-8));
		}

		/* The line between the trips: on the grid, so it runs the taller one's height. */
		.trips::before {
			position: absolute;
			inset-block: 0;
			left: 50%;
			content: '';
			border-left: var(--border-w-hair) solid var(--border-default);
		}

		.field-row--stack {
			flex-direction: row;
			gap: var(--control-gap);
		}
	}

	/* A desktop: the order on the left, its money and saving in a column on the right. */
	@container (width >= 1280px) {
		.order {
			display: grid;
			grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr);
			column-gap: var(--space-12);
			align-items: start;
		}

		.order__notice {
			grid-column: 1 / -1;
			margin-bottom: 0;
		}

		.order__side {
			position: sticky;
			top: 0;
			padding-left: var(--space-12);
			border-left: var(--border-w-hair) solid var(--border-default);
		}
	}
</style>
