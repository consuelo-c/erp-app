import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import type { MovementDetail } from '$lib/server/services/cash';
import Page from './+page@.svelte';

const movement = {
	id: 7,
	movementDate: '2026-10-10',
	concept: 'INSTALLMENT',
	amount: 150000,
	method: 'CASH',
	orderId: 1043,
	receivableId: null,
	weekNumber: null,
	employeeName: null,
	payee: null,
	description: null,
	recordedBy: 'ventas',
	recordedAt: 1791640800,
	receiptNumber: 12,
	otherMethod: null,
	bankAccount: null,
	notes: null,
	reverses: null,
	reversedBy: null,
	settlement: null
} satisfies MovementDetail;

const company = { COMPANY_NAME: 'Banquetes Consuelo C', COMPANY_ADDRESS: '', COMPANY_PHONE: '' };

test('the receipt prints on a portrait letter page with no margin', () => {
	const data = { receipt: { movement, company, receivableOrderIds: [] }, opensCashBook: false };
	const { head, body } = render(Page, { props: { data } as never });
	expect(body).toContain('RECIBO DE CAJA');
	expect(head).toMatch(/@page\s*\{\s*size:\s*letter;\s*margin:\s*0;?\s*\}/);
});
