import { readdirSync, readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import Page from './+page.svelte';

const data = { siteKey: '1x00000000000000000000AA', minDate: '2026-10-21', whatsAppHref: null };

function landing(props: { data?: object; form?: object | null } = {}) {
	return render(Page, { props: { data, form: null, ...props } as never }).body;
}

test('the landing shows the logo, an icon link to /login named Empleados, and the lookup', () => {
	const body = landing();
	expect(body).toContain('src="/banquetes-consuelo-c-logo.svg"');
	expect(body).toMatch(/<a[^>]*href="\/login"[^>]*aria-label="Empleados"/);
	expect(body).toContain('Consulte su pedido');
	expect(body).toMatch(/<input[^>]*name="phone"[^>]*type="tel"/);
	expect(body).toMatch(/<input[^>]*name="event_date"[^>]*type="date"[^>]*min="2026-10-21"/);
	expect(body).toContain('Consultar');
	expect(body).not.toContain('tel:');
	expect(body).not.toContain('Llámenos');
});

test('the WhatsApp button from the start, and none while the number is empty', () => {
	expect(landing()).not.toContain('Escríbanos por WhatsApp');
	const whatsAppHref = 'https://wa.me/573105550142?text=Hola';
	expect(landing({ data: { ...data, whatsAppHref } })).toMatch(
		/<a[^>]*href="https:\/\/wa.me\/573105550142\?text=Hola"[^>]*aria-label="Escríbanos por WhatsApp"/
	);
});

test('two or more matches list below the form, each opening its page', () => {
	const matches = [
		{ id: 1043, status: 'CONFIRMED', token: 'a1' },
		{ id: 1060, status: 'DELIVERED', token: 'b2' }
	];
	const body = landing({ form: { phone: '3104428890', event_date: '2026-10-31', matches } });
	expect(body).toMatch(/href="\/mi-pedido\/a1"[\s\S]*Pedido #1043 · Confirmado/);
	expect(body).toMatch(/href="\/mi-pedido\/b2"[\s\S]*Pedido #1060 · Entregado/);
	expect(body).toContain('value="3104428890"');
});

test('only the landing references Turnstile', () => {
	const files = readdirSync('src/routes', { recursive: true, encoding: 'utf8' }).filter((file) =>
		/\.(svelte|ts)$/.test(file)
	);
	const referencing = files.filter(
		(file) =>
			!file.endsWith('.test.ts') &&
			readFileSync(`src/routes/${file}`, 'utf8').includes('challenges.cloudflare.com')
	);
	expect(referencing).toEqual(['+page.svelte']);
});
