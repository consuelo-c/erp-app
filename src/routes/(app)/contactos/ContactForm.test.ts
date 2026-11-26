import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import type { ContactLabel } from '$lib/contact-labels';
import type { Contact } from '$lib/server/services/contacts';
import ContactForm from './ContactForm.svelte';

const labels: ContactLabel[] = [
	{ key: 'CHEF', name: 'Chef' },
	{ key: 'DECORATOR', name: 'Decorador' },
	{ key: 'TRANSPORTER', name: 'Transportador' },
	{ key: 'BANNED', name: 'Vetado' }
];

const contact: Contact = {
	id: 1,
	phone: '573104428890',
	whatsapp: null,
	fullName: 'Carlos Ruiz',
	documentId: '71234567',
	hasAutoDocument: false,
	labels: ['BANNED', 'CHEF'],
	email: null,
	address1: null,
	address2: null,
	bankAccount: null,
	notes: null,
	isEmployee: false
};

function renderForm(props: { contact: Contact | null; isManager: boolean }): string {
	return render(ContactForm, { props: { ...props, labels, form: null } }).body;
}

test('for Sales the etiquetas read locked, by name, and still post their keys', () => {
	const body = renderForm({ contact, isManager: false });
	expect(body).toContain('Chef · Vetado');
	expect(body).toContain('Solo Gerente o Administrador lo cambian');
	expect(body).toContain('type="hidden" name="labels" value="BANNED"');
	expect(body).not.toContain('type="checkbox"');
	expect(renderForm({ contact: null, isManager: false })).toContain('Ninguna');
});

test('for the manager, one chip per etiqueta in the setting, Vetado in the danger tone', () => {
	const body = renderForm({ contact, isManager: true });
	expect(body.match(/name="labels"/g)).toHaveLength(4);
	expect(body).toMatch(/chip--error[^"]*">(<!--[^>]*-->)*<input[^>]*value="BANNED"/);
});

test('an etiqueta refused by its whole path is marked on the etiquetas field', () => {
	const form = { message: 'Revisa', errors: { 'labels.0': 'Esa etiqueta no vale' }, values: {} };
	const body = render(ContactForm, { props: { contact, isManager: true, labels, form } }).body;
	expect(body).toContain('Esa etiqueta no vale');
});
