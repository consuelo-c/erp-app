import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import type { PrintedOrder, ReceivablePrintout } from '$lib/server/services/receivables';
import Page from './+page@.svelte';

function orderOf(id: number, lineCount = 2): PrintedOrder {
	const items = Array.from({ length: lineCount }, (_, index) => ({
		product_id: index + 1,
		name: `Producto ${index + 1}`,
		qty: 1,
		list_price: 1000,
		unit_price: 1000,
		line_total: 1000
	}));
	return {
		id,
		items,
		itemsTotal: 1000 * lineCount,
		rentalDays: 1,
		discount: 0,
		transportCost: 0,
		orderTotal: 1000 * lineCount
	};
}

const base: ReceivablePrintout = {
	id: 4794,
	issueDate: '2026-10-13',
	paymentTerms: 'Contado',
	client: {
		name: 'Postobón S.A.',
		phone: '576045765100',
		whatsapp: null,
		documentId: '8909039395',
		address: 'Calle 52 #47-42, Medellín'
	},
	orders: [orderOf(1043)],
	total: 2000,
	company: {
		COMPANY_NAME: 'Banquetes Consuelo C.',
		COMPANY_ADDRESS: 'Calle 38a #79-18, Medellín, Colombia',
		COMPANY_PHONE: '(+57) 604 411 44 29'
	}
};

function printout(overrides: Partial<ReceivablePrintout> = {}) {
	const data = { printout: { ...base, ...overrides } };
	return render(Page, { props: { data } as never }).body;
}

// Each sheet, from its own `<article>` to the next.
function sheetsOf(body: string): string[] {
	return body.split('<article').slice(1);
}

test('one order: its date and client, with no block heading and no «TOTAL A PAGAR»', () => {
	const body = printout();
	expect(sheetsOf(body)).toHaveLength(1);
	expect(body).toContain('Medellín, 13 de octubre de 2026');
	expect(body).toContain('CUENTA DE COBRO Nº 4794');
	expect(body).toContain('Remisión 1043');
	expect(body).toContain('NIT/C.C.');
	expect(body).toContain('Calle 52 #47-42, Medellín');
	expect(body).not.toContain('print-block__title');
	expect(body).not.toContain('TOTAL A PAGAR');
	expect(body).not.toContain(' de 1<');
});

test('an automatic document prints no «NIT/C.C.» line', () => {
	const body = printout({ client: { ...base.client, documentId: null } });
	expect(body).not.toContain('NIT/C.C.');
});

test('two orders: each block headed by number, then «TOTAL A PAGAR»', () => {
	const body = printout({ orders: [orderOf(1043), orderOf(1060)], total: 4000 });
	expect(body).toContain('Remisiones 1043 y 1060');
	expect(body).toMatch(/print-block__title[^>]*>Remisión 1043/);
	expect(body).toMatch(/print-block__title[^>]*>Remisión 1060/);
	expect(body).toMatch(/TOTAL A PAGAR<\/span><span[^>]*>\$4\.000/);
});

test('no advance, paid, balance or amount in words', () => {
	const body = printout();
	for (const word of ['Anticipo', 'Pagado', 'Saldo', 'pesos']) {
		expect(body).not.toContain(word);
	}
});

test('three orders of 15 lines: two numbered sheets, the closing only on the last', () => {
	const orders = [orderOf(1043, 15), orderOf(1060, 15), orderOf(1072, 15)];
	const sheets = sheetsOf(printout({ orders, total: 45000 }));
	expect(sheets).toHaveLength(2);
	expect(sheets[0]).toContain('CUENTA DE COBRO Nº 4794');
	expect(sheets[0]).toContain('1 de 2');
	expect(sheets[1]).toContain('CUENTA DE COBRO Nº 4794');
	expect(sheets[1]).toContain('2 de 2');
	for (const closing of ['TOTAL A PAGAR', 'Bancolombia', 'RÉGIMEN SIMPLIFICADO', 'signature']) {
		expect(sheets[0]).not.toContain(closing);
		expect(sheets[1]).toContain(closing);
	}
});

test('a block split across sheets prints its totals under its last line', () => {
	const orders = [orderOf(1043, 15), orderOf(1060, 15), orderOf(1072, 15)];
	const sheets = sheetsOf(printout({ orders, total: 45000 }));
	expect(sheets[0].match(/>TOTAL</g)).toHaveLength(1);
	expect(sheets[1].match(/>TOTAL</g)).toHaveLength(2);
	expect(sheets[1]).toMatch(/Producto 15[\s\S]*SUBTOTAL/);
});

test("a single order's totals stay with its last line when the closing takes its own sheet", () => {
	const sheets = sheetsOf(printout({ orders: [orderOf(1043, 30)] }));
	expect(sheets).toHaveLength(2);
	expect(sheets[0]).toContain('SUBTOTAL');
	expect(sheets[1]).not.toContain('SUBTOTAL');
	expect(sheets[1]).toContain('Bancolombia');
});
