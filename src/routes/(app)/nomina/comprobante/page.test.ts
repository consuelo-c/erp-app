import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import Page from './+page@.svelte';

const receipt = {
	draft: {
		employeeId: 3,
		weekNumber: 41,
		paymentDate: '2026-10-10',
		earnings: [],
		deductions: [],
		totalEarnings: 0,
		totalDeductions: 0,
		netPay: 0
	},
	payment: {
		employeeName: 'Andrés Felipe Gómez',
		employeeIdNumber: '1036612345',
		employeePosition: null,
		preparedBy: 'gerente'
	},
	company: { COMPANY_NAME: 'Banquetes Consuelo C', COMPANY_ADDRESS: '', COMPANY_PHONE: '' },
	periodStart: '2026-10-05',
	periodEnd: '2026-10-11',
	extraHours: { start: '2026-09-28', end: '2026-10-04' }
};

test('the toolbar offers «Volver» and «Imprimir», and the sheet prints unturned', () => {
	const { head, body } = render(Page, { props: { data: { receipt } } as never });
	expect(body).toMatch(/Volver a la liquidación[\s\S]*Imprimir/);
	expect(body).not.toContain('Vertical');
	expect(head).not.toContain('page-orientation');
});

test('the slip prints no «Horas extras» nor the company name, and numbers itself «1 de 1»', () => {
	const { body } = render(Page, { props: { data: { receipt } } as never });
	expect(body).not.toContain('Horas extras');
	expect(body).not.toMatch(/<div class="print-small[^"]*">Banquetes Consuelo C</);
	expect(body).toContain('1 de 1');
});
