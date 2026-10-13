import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import Button from './Button.svelte';
import Field from './Field.svelte';
import Modal from './Modal.svelte';

const text = (html: string) => createRawSnippet(() => ({ render: () => html }));

test('Field ties its label to the control id', () => {
	const { body } = render(Field, {
		props: { label: 'Usuario', id: 'username', children: text('<input id="username" />') }
	});
	expect(body).toContain('for="username"');
});

test('Button renders a link when given href, a button otherwise', () => {
	const label = text('<span>Entrar</span>');
	const link = render(Button, { props: { href: '/login', children: label } });
	const button = render(Button, { props: { children: label } });
	expect(link.body).toMatch(/<a [^>]*href="\/login"/);
	expect(link.body).not.toContain('<button');
	expect(button.body).toContain('<button');
	expect(button.body).not.toContain('<a ');
});

test('Modal is a native dialog labelled by its title', () => {
	const { body } = render(Modal, {
		props: { title: 'Cerrar sesión', body: 'Vuelves a entrar.', actions: text('<span></span>') }
	});
	const titleId = body.match(/<h2[^>]*id="([^"]+)"/)?.[1];
	expect(body).toContain('<dialog');
	expect(body).toContain(`aria-labelledby="${titleId}"`);
});
