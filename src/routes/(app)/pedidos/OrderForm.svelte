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
	import OrderLines, { toFormLine, type FormLine } from './OrderLines.svelte';
	import { moveThroughResults } from './order-form';

	// One screen, top to bottom, no wizard: the salesperson fills it in while the client talks.
	// Everything is typed into local state and posted as one JSON field; the server validates it
	// and works the totals out again. Availability, holidays and clashes only warn.
	interface Props {
		options: OrderFormOptions;
		/** Null for a new order. */
		order: OrderDetail | null;
		/** The delivered order a new extension comes from. */
		original?: OrderDetail | null;
		/** A refused save: its message and each field's. */
		form: { message: string; errors: Record<string, string> } | null | undefined;
	}

	let { options, order, original = null, form }: Props = $props();

	// While the save is on its way, so the button doesn't post it twice.
	let isSaving = $state(false);

	const FORM_ID = 'order-form';
	const EMPTY_TIME = { hour: '', minute: '', period: 'am' as const };

	// The company's warehouse: where the client picks up or brings back.
	const warehouse = $derived({
		address1: options.company.address,
		address2: `Bodega ${options.company.name}`
	});

	type Choice = number | 'new' | null;
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
		choice: Choice;
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

	function readFields(): Fields {
		if (null !== original) {
			return extensionFields(original);
		}
		return null === order ? structuredClone(NEW_ORDER) : savedFields(order);
	}

	// Read once: a refused save keeps this state, so what was typed is still there.
	const fields = readFields();
	let phone = $state(fields.phone);
	let eventDate = $state(fields.eventDate);
	let choice = $state(fields.choice);
	let candidates = $state<ClientCandidate[]>([]);
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

	let clientQuery = $state('');
	// The client picked stays listed on top while another search is typed; on an edit, the order's.
	let picked = $state(fields.picked);
	const clientOptions = $derived.by(() => {
		const own = 'new' === choice ? null : picked;
		if (null === own || candidates.some((candidate) => own.id === candidate.id)) {
			return candidates;
		}
		return [own, ...candidates];
	});

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
	// For reference only: the discount is stored in pesos.
	const discountShare = $derived(
		0 === totals.itemsTotal
			? ''
			: `≈ ${((parsePesos(discount) / totals.itemsTotal) * 100).toFixed(1).replace('.', ',')} %`
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

	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	// The contacts matching what's typed, by name, phone or address, once the typing pauses.
	function searchClients() {
		clearTimeout(searchTimer);
		const typed = clientQuery.trim();
		if ('' === typed) {
			candidates = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			const query = new URLSearchParams({ texto: typed });
			const response = await fetch(`${resolve('/pedidos/clientes')}?${query}`);
			if (response.ok && typed === clientQuery.trim()) {
				candidates = await response.json();
			}
		}, 300);
	}

	let clientList: HTMLElement | undefined = $state();

	function clientRadios(): Iterable<HTMLInputElement> {
		return clientList?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [];
	}

	// Enter would submit the order: it picks the first contact found instead. Down goes to the cards.
	function keyInSearch(event: KeyboardEvent) {
		if ('Enter' !== event.key) {
			moveThroughResults(event, event.currentTarget as HTMLElement, clientRadios());
			return;
		}
		event.preventDefault();
		if (candidates.length) {
			pick(candidates[0]);
		}
	}

	// The arrows only move the focus between the cards; Enter picks the focused one.
	function keyInCards(event: KeyboardEvent) {
		if ('Enter' === event.key) {
			event.preventDefault();
			(event.target as HTMLElement).click();
			return;
		}
		moveThroughResults(event, document.getElementById('client-search'), clientRadios());
	}

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
		choice = candidate.id;
		picked = candidate;
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
		choice = 'new';
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

	function addressOf(candidate: ClientCandidate): string {
		return [candidate.address1, candidate.address2].filter(Boolean).join(', ');
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
		<Field label="Cliente" id="client-search">
			<Input
				id="client-search"
				type="search"
				autocomplete="off"
				placeholder="Buscar por nombre, teléfono o dirección"
				bind:value={clientQuery}
				oninput={searchClients}
				onkeydown={keyInSearch}
			/>
		</Field>

		<!-- With nothing searched, only the client picked, if any, and «Cliente nuevo». -->
		<fieldset class="choice clients" aria-label="Escoge el cliente">
			<div class="clients__list" bind:this={clientList}>
				{#each clientOptions as candidate (candidate.id)}
					<label class="client">
						<input
							type="radio"
							name="client"
							checked={candidate.id === choice}
							onchange={() => pick(candidate)}
							onkeydown={keyInCards}
						/>
						<span class="client__text">
							<span class="client__name">{candidate.fullName}</span>
							<span class="meta">{formatPhone(candidate.phone)}</span>
							{#if candidate.address1}
								<span class="meta">{addressOf(candidate)}</span>
							{/if}
						</span>
					</label>
				{/each}
				<label class="client">
					<input
						type="radio"
						name="client"
						checked={'new' === choice}
						onchange={pickNewClient}
						onkeydown={keyInCards}
					/>
					<span class="client__text">
						<span class="client__name">Cliente nuevo</span>
						<span class="meta">Con el teléfono y el nombre que escribas</span>
					</span>
				</label>
			</div>
			{#if errorOf('client_id')}
				<p class="field-error">{errorOf('client_id')}</p>
			{/if}
		</fieldset>

		<div class="field-row">
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
			<Field label="Fecha del evento" id="event-date" error={errorOf('event_date')}>
				<Input
					id="event-date"
					type="date"
					aria-invalid={undefined !== errorOf('event_date')}
					bind:value={eventDate}
				/>
			</Field>
		</div>

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

		<OrderLines
			bind:lines
			products={options.products}
			{availability}
			{rangeLabel}
			rentalDays={rentalDayCount}
			{errorOf}
			{original}
		/>
	</div>

	<div class="order__side">
		<h2 class="section-title">Cliente</h2>
		<div class="form-stack">
			<Field label="Nombre" id="client-name" error={errorOf('client_name')}>
				<Input
					id="client-name"
					placeholder="Ej. Luz Marina Restrepo"
					aria-invalid={undefined !== errorOf('client_name')}
					bind:value={clientName}
				/>
			</Field>
			<Field label="Método de entrega" id="delivery-method">
				<Select id="delivery-method" bind:value={deliveryMethod} onchange={changeDeliveryMethod}>
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
					: addressNote}
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
			<Field label="Notas" id="notes" hint="Opcional: lo que bodega y el conductor deben saber.">
				<textarea
					class="notes"
					id="notes"
					rows="3"
					placeholder="Ej. Entrar por el portón de servicio"
					bind:value={notes}></textarea>
			</Field>
		</div>

		<h2 class="section-title">Totales</h2>
		<div class="form-stack totals">
			<Field label="Descuento" id="discount" error={errorOf('discount')}>
				<div class="discount">
					<Input
						id="discount"
						inputmode="numeric"
						placeholder="$0"
						aria-invalid={undefined !== errorOf('discount')}
						bind:value={discount}
					/>
					<span class="discount__share">{discountShare}</span>
				</div>
			</Field>
			<Field label="Transporte" id="transport" error={errorOf('transport_cost')}>
				<Input
					id="transport"
					inputmode="numeric"
					placeholder="$0"
					aria-invalid={undefined !== errorOf('transport_cost')}
					bind:value={transport}
				/>
			</Field>
		</div>
		<div class="summary-row summary-row--total">
			<span>Total</span><span>{formatPesos(totals.orderTotal)}</span>
		</div>

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

	.field--narrow {
		width: 110px;
	}

	.field-error {
		margin-top: var(--space-3);
		font-size: var(--text-xs);
		color: var(--error-fg);
	}

	.choice {
		min-width: 0;
		padding: 0;
		margin: 0;
		border: 0;
	}

	.clients__list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* A client to pick: the whole card is the radio's label, the ink border marks the picked one. */
	.client {
		box-sizing: border-box;
		display: flex;
		gap: var(--space-6);
		align-items: center;
		min-height: 52px;
		padding: var(--space-4) var(--space-7);
		cursor: pointer;
		border: var(--border-w-strong) solid var(--border-default);
		border-radius: var(--radius-card);
	}

	.client:has(input:checked) {
		border-color: var(--border-strong);
	}

	.client input {
		flex: none;
		width: 18px;
		height: 18px;
		margin: 0;
		accent-color: var(--neutral-800);
	}

	.client__text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.client__name {
		font-size: var(--text-base);
		font-weight: var(--weight-medium);
	}

	.client:has(input:checked) .client__name {
		font-weight: var(--weight-bold);
	}

	.trips {
		display: grid;
		gap: var(--space-8);
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

	/* The Design System's summary rows: the subtotal, and the total under its ink rule. */
	.summary-row {
		display: flex;
		gap: var(--space-5);
		align-items: center;
		justify-content: space-between;
		font-size: var(--text-base);
		line-height: var(--leading-loose);
		color: var(--text-secondary);
	}

	.summary-row > :last-child {
		font-weight: var(--weight-semibold);
		color: var(--text-body);
	}

	.summary-row--total {
		padding: var(--space-7) 0;
		font-size: var(--text-lg);
		font-weight: var(--weight-bold);
		line-height: 1.2;
		color: var(--text-body);
		border-top: var(--border-w) solid var(--border-strong);
	}

	.summary-row--total > :last-child {
		font: var(--type-total);
	}

	.discount {
		display: flex;
		gap: var(--space-6);
		align-items: center;
	}

	.discount__share {
		flex: none;
		width: 64px;
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
		color: var(--text-secondary);
	}

	.detail-list .meta {
		display: block;
	}

	@container (width >= 1024px) {
		.trips {
			grid-template-columns: 1fr 1fr;
		}
	}

	/* A desktop: the order on the left, the client, totals and saving in a column on the right. */
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
