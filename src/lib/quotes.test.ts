import { afterEach, expect, test, vi } from 'vitest';
import { getTodaysDate } from './datetime';
import { CLIENT_TRANSPORTED_BY_LABELS, QUOTE_STATE_LABELS, TRANSPORTED_BY_LABELS } from './labels';
import {
	describeConversionGaps,
	describeRemovedProducts,
	getQuoteState,
	toOrderMethods,
	transportedByOf
} from './quotes';

afterEach(() => {
	vi.useRealTimers();
});

test('with the clock on 2 December 2026, an open quote is valid through its date', () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-12-02T15:00:00Z'));
	const today = getTodaysDate();
	expect(getQuoteState({ orderId: null, validUntil: '2026-12-02' }, today)).toBe('VALID');
	expect(getQuoteState({ orderId: null, validUntil: '2026-12-01' }, today)).toBe('EXPIRED');
	expect(getQuoteState({ orderId: 1060, validUntil: '2027-01-31' }, today)).toBe('CONVERTED');
	expect(getQuoteState({ orderId: 1060, validUntil: '2026-12-01' }, today)).toBe('CONVERTED');
});

test("at 11:30 p.m. on 1 December in Bogotá, already the 2nd in UTC, it's still valid", () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-12-02T04:30:00Z'));
	expect(getQuoteState({ orderId: null, validUntil: '2026-12-01' }, getTodaysDate())).toBe('VALID');
});

test('each state reaches the screen through its label', () => {
	expect(QUOTE_STATE_LABELS).toEqual({
		VALID: 'Vigente',
		EXPIRED: 'Vencida',
		CONVERTED: 'Convertida'
	});
});

test('«Duplicar» names the inactive products it left out: one, or how many, in order', () => {
	expect(describeRemovedProducts([])).toBeNull();
	expect(describeRemovedProducts(['Silla Rimax'])).toBe(
		'Se quitó un producto inactivo: Silla Rimax.'
	);
	expect(describeRemovedProducts(['Silla Rimax', 'Mantel rosa'])).toBe(
		'Se quitaron 2 productos inactivos: Mantel rosa, Silla Rimax.'
	);
});

test('«Convertir en pedido» says the trips come from the event date, or that the dates are missing; the methods come from the quote', () => {
	const dated = { eventDate: '2026-12-12', transportCost: 180000 };
	expect(describeConversionGaps(dated)).toBe(
		'el descuento, el transporte y las notas. La entrega y la recogida salen de la fecha del evento; faltan las horas.'
	);
	expect(describeConversionGaps({ ...dated, transportCost: null })).toBe(
		'el descuento y las notas. La entrega y la recogida salen de la fecha del evento; faltan las horas y el transporte.'
	);
	expect(describeConversionGaps({ ...dated, eventDate: null })).toBe(
		'el descuento, el transporte y las notas. Faltan las fechas.'
	);
	expect(describeConversionGaps({ eventDate: null, transportCost: null })).toBe(
		'el descuento y las notas. Faltan las fechas y el transporte.'
	);
});

test('«Convertir en pedido» fills both methods from who transports', () => {
	expect(toOrderMethods('COMPANY')).toEqual({
		deliveryMethod: 'COMPANY_DELIVERY',
		returnMethod: 'COMPANY_PICKUP'
	});
	expect(toOrderMethods('CLIENT')).toEqual({
		deliveryMethod: 'CLIENT_PICKUP',
		returnMethod: 'CLIENT_RETURN'
	});
});

test('«Cotizar de nuevo» reads who transports from the delivery method: only a client pickup is the client', () => {
	expect(transportedByOf('CLIENT_PICKUP')).toBe('CLIENT');
	expect(transportedByOf('COMPANY_DELIVERY')).toBe('COMPANY');
	expect(transportedByOf('EXTERNAL_CARRIER')).toBe('COMPANY');
});

test('who transports reaches the screen through its labels, for staff and for the client', () => {
	expect(TRANSPORTED_BY_LABELS).toEqual({ COMPANY: 'La empresa', CLIENT: 'El cliente' });
	expect(CLIENT_TRANSPORTED_BY_LABELS).toEqual({
		COMPANY: 'Entrega y recogida en su evento',
		CLIENT: 'Recoge y devuelve en la bodega'
	});
});
