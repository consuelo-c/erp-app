import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import type { QuotePrintout } from '$lib/server/services/quotes';
import Page from './+page@.svelte';

const company = {
	COMPANY_NAME: 'Banquetes Consuelo C',
	COMPANY_ADDRESS: 'Calle 38a #79-18, Medellín, Colombia',
	COMPANY_PHONE: '(+57) 604 411 44 29'
};

function itemsOf(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		product_id: index + 1,
		name: `Producto ${index + 1}`,
		qty: 1,
		list_price: 1000,
		unit_price: 1000,
		line_total: 1000
	}));
}

const quote = {
	id: 12,
	state: 'VALID',
	clientId: 1,
	orderId: null,
	client: { name: 'Postobón S.A.', phone: '576045765100', whatsapp: null },
	eventDate: null,
	validUntil: '2026-12-03',
	rentalDays: 1,
	items: itemsOf(3),
	itemsTotal: 3000,
	discount: 0,
	transportCost: null,
	quoteTotal: 3000,
	address1: null,
	address2: null,
	notes: 'Precios incluyen montaje y desmontaje',
	createdAt: 1793736000
} satisfies QuotePrintout['quote'];

function printout(overrides: Partial<QuotePrintout> = {}) {
	const data = { printout: { quote, document: '8909039395', company, ...overrides } };
	return render(Page, { props: { data } as never }).body;
}

// Each sheet, from its own `<article>` to the next.
function sheetsOf(body: string): string[] {
	return body.split('<article').slice(1);
}

test('30 lines print on two sheets, each titled and numbered; totals and notes only on the last', () => {
	const sheets = sheetsOf(printout({ quote: { ...quote, items: itemsOf(30) } }));
	expect(sheets).toHaveLength(2);
	expect(sheets[0]).toContain('Cotización #12');
	expect(sheets[0]).toContain('1 de 2');
	expect(sheets[0]).not.toContain('Subtotal');
	expect(sheets[0]).not.toContain(quote.notes);
	expect(sheets[1]).toContain('Cotización #12');
	expect(sheets[1]).toContain('2 de 2');
	expect(sheets[1]).toContain('Subtotal');
	expect(sheets[1]).toContain(quote.notes);
});

test('«por acordar» prints as such, with «Total sin transporte»; a priced one prints «Total»', () => {
	expect(printout()).toMatch(/Transporte<\/span>\s*<span>Por acordar/);
	expect(printout()).toContain('Total sin transporte');
	const priced = printout({ quote: { ...quote, transportCost: 0 } });
	expect(priced).toMatch(/Transporte<\/span>\s*<span>\$0/);
	expect(priced).not.toContain('Total sin transporte');
});

test('the document prints under «NIT / C.C.», and nothing in its place when there is none', () => {
	expect(printout()).toMatch(/NIT \/ C\.C\.<\/span><span>8909039395/);
	expect(printout({ document: null })).not.toContain('NIT / C.C.');
});

test('the event date and «Lugar del evento» print only when set', () => {
	expect(printout()).not.toContain('Evento');
	expect(printout()).not.toContain('Lugar del evento');
	const set = {
		eventDate: '2026-12-12',
		address1: 'Hacienda Fizebad',
		address2: 'Salón principal'
	};
	const body = printout({ quote: { ...quote, ...set } });
	expect(body).toContain('Evento');
	expect(body).toMatch(/Hacienda Fizebad[\s\S]*Salón principal/);
});

test('no signature, deposit, payments or terms', () => {
	const body = printout();
	for (const absent of ['Recibí', 'Depósito', 'Pagado', 'Saldo', 'Términos']) {
		expect(body).not.toContain(absent);
	}
});
