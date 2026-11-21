import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import Page from './+page.svelte';

const data = { whatsAppHref: null };

function landing(props: { data?: object } = {}) {
	return render(Page, { props: { data, ...props } as never }).body;
}

test('the landing shows the logo and an icon link to /login named Empleados, and no lookup', () => {
	const body = landing();
	expect(body).toContain('src="/banquetes-consuelo-c-logo.svg"');
	expect(body).toMatch(/<a[^>]*href="\/login"[^>]*aria-label="Empleados"/);
	expect(body).not.toContain('<form');
	expect(body).not.toContain('Consulte su pedido');
	expect(body).not.toContain('tel:');
});

test('the WhatsApp button from the start, and none while the number is empty', () => {
	expect(landing()).not.toContain('Escríbanos por WhatsApp');
	const whatsAppHref = 'https://wa.me/573105550142?text=Hola';
	expect(landing({ data: { ...data, whatsAppHref } })).toMatch(
		/<a[^>]*href="https:\/\/wa.me\/573105550142\?text=Hola"[^>]*aria-label="Escríbanos por WhatsApp"/
	);
});
